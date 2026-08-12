import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";

export const COURSE_MODEL_PROVIDERS = [
  "google-genai",
  "deepseek",
] as const;

const CourseModelConfigSchema = z.object({
  modelProvider: z.enum(COURSE_MODEL_PROVIDERS),
  model: z.string().trim().min(1),
  temperature: z.number().min(0).max(2),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxTokens: z.number().int().min(1).max(25_000),
  maxRetries: z.number().int().min(0).max(15),
});

export type CourseModelConfig = z.infer<typeof CourseModelConfigSchema>;
export type CourseModelProvider = CourseModelConfig["modelProvider"];
type CourseEnvironment = Record<string, string | undefined>;

const DEFAULT_MODEL_CONFIG = {
  modelProvider: "google-genai",
  temperature: 0.2,
  timeoutMs: 120_000,
  maxTokens: 2_048,
  maxRetries: 2,
} as const;

/** 把可选数字环境变量转换成 number；空值继续使用课程默认值。 */
function readNumber(rawValue: string | undefined, fallback: number) {
  if (!rawValue?.trim()) {
    return fallback;
  }
  return Number(rawValue);
}

/** 根据 provider 选择已有模型变量，同时提供官方集成可用的默认模型。 */
function readModelName(
  provider: CourseModelProvider,
  environment: CourseEnvironment,
) {
  const explicitModel = environment.LANGCHAIN_MODEL?.trim();
  if (explicitModel) {
    return explicitModel;
  }

  if (provider === "deepseek") {
    return environment.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  }

  return environment.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
}

/**
 * 从环境变量读取 LC1B 模型配置，并用 Zod 阻止无效范围进入模型 SDK。
 *
 * 这里故意不读取 API Key；密钥属于认证信息，不应该出现在可打印配置中。
 */
export function readCourseModelConfig(
  environment: CourseEnvironment = process.env,
): CourseModelConfig {
  const provider = z
    .enum(COURSE_MODEL_PROVIDERS)
    .parse(
      environment.LANGCHAIN_MODEL_PROVIDER?.trim() ||
        DEFAULT_MODEL_CONFIG.modelProvider,
    );

  return CourseModelConfigSchema.parse({
    modelProvider: provider,
    model: readModelName(provider, environment),
    temperature: readNumber(
      environment.LANGCHAIN_TEMPERATURE,
      DEFAULT_MODEL_CONFIG.temperature,
    ),
    timeoutMs: readNumber(
      environment.LANGCHAIN_TIMEOUT_MS,
      DEFAULT_MODEL_CONFIG.timeoutMs,
    ),
    maxTokens: readNumber(
      environment.LANGCHAIN_MAX_TOKENS,
      DEFAULT_MODEL_CONFIG.maxTokens,
    ),
    maxRetries: readNumber(
      environment.LANGCHAIN_MAX_RETRIES,
      DEFAULT_MODEL_CONFIG.maxRetries,
    ),
  });
}

/**
 * 确认当前 provider 的服务器端认证已配置。
 *
 * Google 集成读取 GOOGLE_API_KEY；为兼容现有项目，只在当前进程内复用
 * GEMINI_API_KEY。函数不会返回、打印或写入任何密钥。
 */
export function configureCourseModelAuthentication(
  config: CourseModelConfig,
  environment: CourseEnvironment = process.env,
) {
  if (config.modelProvider === "deepseek") {
    if (!environment.DEEPSEEK_API_KEY?.trim()) {
      throw new Error("使用 deepseek 时必须在 .env.local 配置 DEEPSEEK_API_KEY");
    }
    return;
  }

  if (environment.GOOGLE_API_KEY?.trim()) {
    return;
  }

  const geminiApiKey = environment.GEMINI_API_KEY?.trim();
  if (!geminiApiKey) {
    throw new Error(
      "使用 google-genai 时必须配置 GOOGLE_API_KEY 或 GEMINI_API_KEY",
    );
  }
  environment.GOOGLE_API_KEY = geminiApiKey;
}

/** 把课程配置转换成两个显式模型构造器共同使用的参数。 */
export function createCourseChatModelOptions(config: CourseModelConfig) {
  return {
    model: config.model,
    temperature: config.temperature,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
}

/**
 * 根据统一课程配置创建具体的 LangChain ChatModel。
 *
 * 这里使用静态导入和明确分支，让 Next/Turbopack 能在构建时确定依赖；
 * provider 的差异仍被封装在工厂函数内，Agent 和 RAG Chain 不需要改变。
 */
export function createCourseChatModel(config: CourseModelConfig) {
  const commonOptions = createCourseChatModelOptions(config);

  if (config.modelProvider === "deepseek") {
    return new ChatDeepSeek({
      ...commonOptions,
      maxTokens: config.maxTokens,
    });
  }

  return new ChatGoogleGenerativeAI({
    ...commonOptions,
    maxOutputTokens: config.maxTokens,
  });
}
