import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  type BaseCheckpointSaver,
  MemorySaver,
} from "@langchain/langgraph";
import { createAgent } from "langchain";

import {
  DEFAULT_QUICKSTART_MODEL,
  getWeather,
} from "./quickstart-agent";

export const STREAMING_SYSTEM_PROMPT = `你是一名天气演示助手。

1. 用户询问天气时，必须调用 get_weather 工具。
2. 最终回答只能依据工具结果。
3. 必须说明这是教材模拟天气，不是真实天气。
4. 必须回答100字以上`;

/**
 * 创建 LC1D 流式 Agent。
 *
 * 继续使用 LC0 的固定天气工具，让注意力集中在事件流，而不是外部网络。
 */
export function createStreamingWeatherAgent(
  model: string | BaseChatModel = DEFAULT_QUICKSTART_MODEL,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
) {
  return createAgent({
    model,
    tools: [getWeather],
    systemPrompt: STREAMING_SYSTEM_PROMPT,
    checkpointer,
  });
}
