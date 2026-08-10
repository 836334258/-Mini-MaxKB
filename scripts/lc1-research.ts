import { loadEnvConfig } from "@next/env";

import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { DEFAULT_QUICKSTART_MODEL } from "../lib/langchain/quickstart-agent";
import { createResearchAgent } from "../lib/langchain/research-agent";

const DEFAULT_RESEARCH_QUESTION = `请读取 https://www.gutenberg.org/cache/epub/11/pg11.txt ，
只根据工具返回的片段，告诉我作品的英文书名和作者。
如果片段中没有足够证据，请明确说不知道。`;

/**
 * 官方 Google 集成读取 GOOGLE_API_KEY；没有单独配置时，只在当前进程内
 * 复用已有 GEMINI_API_KEY，不写入文件，也不打印密钥。
 */
function configureGoogleApiKey() {
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return;
  }

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiApiKey) {
    throw new Error(
      "缺少 GOOGLE_API_KEY 或 GEMINI_API_KEY，请在 .env.local 中配置",
    );
  }
  process.env.GOOGLE_API_KEY = geminiApiKey;
}

/** 读取命令行问题；没有参数时使用《爱丽丝梦游仙境》的公开文本示例。 */
function readQuestion() {
  const argumentsWithoutSeparator = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  return argumentsWithoutSeparator.join(" ").trim() || DEFAULT_RESEARCH_QUESTION;
}

/** 运行 LC1A，并完整打印 Human → AI(tool call) → Tool → AI 消息链。 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  configureGoogleApiKey();

  const model =
    process.env.LANGCHAIN_QUICKSTART_MODEL?.trim() ||
    DEFAULT_QUICKSTART_MODEL;
  const question = readQuestion();
  const agent = createResearchAgent(model);

  console.log(`LC1A 系统提示词 + 外部文本工具：${model}`);
  console.log(`用户问题：${question}\n`);

  const result = await agent.invoke({
    messages: [{ role: "user", content: question }],
  });
  const finalMessage = result.messages.at(-1);

  console.log("完整 Agent 状态：");
  console.dir(result, { depth: null, colors: true });
  console.log(`\n最终回答：${finalMessage?.text || "（没有文本回答）"}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC1A 运行失败：${message}`);
  process.exitCode = 1;
});
