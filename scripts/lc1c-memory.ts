import { loadEnvConfig } from "@next/env";

import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  createMemoryAgent,
  createThreadConfig,
} from "../lib/langchain/memory-agent";
import {
  configureCourseModelAuthentication,
  createCourseChatModel,
  readCourseModelConfig,
} from "../lib/langchain/model-config";

const SAME_THREAD_ID = "lc1c-user-a";
const ISOLATED_THREAD_ID = "lc1c-user-b";

/** 从 Agent 状态中读取最后一条模型文本。 */
function readFinalText(result: { messages: Array<{ text: string }> }) {
  return result.messages.at(-1)?.text || "（没有文本回答）";
}

/**
 * 连续运行三个回合：A 线程写入偏好、A 线程追问、B 线程追问。
 * 第三个回合用于证明 thread_id 不同就不会共享短期记忆。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const modelConfig = readCourseModelConfig();
  configureCourseModelAuthentication(modelConfig);
  const model = await createCourseChatModel(modelConfig);
  const agent = createMemoryAgent(model);
  const sameThreadConfig = createThreadConfig(SAME_THREAD_ID);
  const isolatedThreadConfig = createThreadConfig(ISOLATED_THREAD_ID);

  console.log("LC1C MemorySaver + thread_id：");
  console.table(modelConfig);

  const remembered = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "请记住：我最喜欢的编程语言是 TypeScript。只回复“记住了”。",
        },
      ],
    },
    sameThreadConfig,
  );
  console.log(`\nA 线程第 1 轮：${readFinalText(remembered)}`);

  const recalled = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "我最喜欢的编程语言是什么？",
        },
      ],
    },
    sameThreadConfig,
  );
  console.log(`A 线程第 2 轮：${readFinalText(recalled)}`);

  const isolated = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "我最喜欢的编程语言是什么？",
        },
      ],
    },
    isolatedThreadConfig,
  );
  console.log(`B 线程第 1 轮：${readFinalText(isolated)}`);

  console.log("\n完整线程状态：");
  console.dir(
    {
      sameThreadId: SAME_THREAD_ID,
      sameThreadState: recalled,
      isolatedThreadId: ISOLATED_THREAD_ID,
      isolatedThreadState: isolated,
    },
    { depth: null, colors: true },
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC1C 运行失败：${message}`);
  process.exitCode = 1;
});
