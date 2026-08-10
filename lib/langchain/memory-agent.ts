import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  type BaseCheckpointSaver,
  MemorySaver,
} from "@langchain/langgraph";
import { createAgent } from "langchain";

import { DEFAULT_QUICKSTART_MODEL } from "./quickstart-agent";

export const MEMORY_SYSTEM_PROMPT = `你是一名谨慎的偏好记忆助手。

1. 用户明确告诉你的偏好，可以在当前对话线程中记住。
2. 回答“我的偏好是什么”一类问题时，只能依据当前线程中的消息。
3. 当前线程没有相关信息时，必须回答不知道，不能猜测。`;

/**
 * 创建 LC1C 短期记忆 Agent。
 *
 * MemorySaver 只保存在当前 Node.js 进程内；重启进程后数据会消失。
 * checkpointer 参数可注入，方便测试以及后续替换为数据库实现。
 */
export function createMemoryAgent(
  model: string | BaseChatModel = DEFAULT_QUICKSTART_MODEL,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
) {
  return createAgent({
    model,
    tools: [],
    systemPrompt: MEMORY_SYSTEM_PROMPT,
    checkpointer,
  });
}

/**
 * 为一次 Agent 调用创建线程配置。
 *
 * 相同 thread_id 会读写同一份消息状态；不同 thread_id 必须彼此隔离。
 */
export function createThreadConfig(threadId: string) {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new Error("thread_id 不能为空");
  }

  return {
    configurable: {
      thread_id: normalizedThreadId,
    },
  } as const;
}
