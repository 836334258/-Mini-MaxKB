import { loadEnvConfig } from "@next/env";

import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  createQuickstartAgent,
  DEFAULT_QUICKSTART_MODEL,
} from "../lib/langchain/quickstart-agent";

/**
 * 官方 Google 集成读取 GOOGLE_API_KEY；为复用现有配置，只在进程内把
 * GEMINI_API_KEY 映射过去，密钥不会写入文件、输出或发送到浏览器。
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

/** 从命令行读取问题；未传参数时使用一个必然触发天气工具的示例。 */
function readQuestion() {
  const argumentsWithoutSeparator = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  return (
    argumentsWithoutSeparator.join(" ").trim() || "上海今天的天气怎么样？"
  );
}

/** 运行第一课 Agent，并完整打印消息状态和最终回答。 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  configureGoogleApiKey();

  const model =
    process.env.LANGCHAIN_QUICKSTART_MODEL?.trim() ||
    DEFAULT_QUICKSTART_MODEL;
  const question = readQuestion();
  const agent = createQuickstartAgent(model);

  console.log(`LC0 官方 Quickstart：${model}`);
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
  console.error(`LC0 运行失败：${message}`);
  process.exitCode = 1;
});
