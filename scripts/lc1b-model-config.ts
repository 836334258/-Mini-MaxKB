import { loadEnvConfig } from "@next/env";

import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  configureCourseModelAuthentication,
  createCourseChatModel,
  readCourseModelConfig,
} from "../lib/langchain/model-config";
import { createResearchAgent } from "../lib/langchain/research-agent";

const DEFAULT_RESEARCH_QUESTION = `请读取 https://www.gutenberg.org/cache/epub/11/pg11.txt ，
只根据工具返回的片段，告诉我作品的英文书名和作者。
如果片段中没有足够证据，请明确说不知道。`;

/** 读取命令行问题；没有参数时继续使用 LC1A 的公开文本示例。 */
function readQuestion() {
  const argumentsWithoutSeparator = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  return argumentsWithoutSeparator.join(" ").trim() || DEFAULT_RESEARCH_QUESTION;
}

/**
 * 运行 LC1B：先用 initChatModel 创建模型对象，再把模型对象交给研究 Agent。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const modelConfig = readCourseModelConfig();
  configureCourseModelAuthentication(modelConfig);
  const model = await createCourseChatModel(modelConfig);
  const agent = createResearchAgent(model);
  const question = readQuestion();

  console.log("LC1B initChatModel 模型配置：");
  console.table(modelConfig);
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
  console.error(`LC1B 运行失败：${message}`);
  process.exitCode = 1;
});
