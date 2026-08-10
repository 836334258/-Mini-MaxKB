import { createAgent, tool } from "langchain";
import * as z from "zod";

export const DEFAULT_QUICKSTART_MODEL =
  "google-genai:gemini-3.5-flash";

/**
 * 教材中的天气工具使用固定模拟数据，目的是观察模型如何选择并调用工具，
 * 不代表真实天气查询。后续课程会把它替换成真实 API。
 */
export const getWeather = tool(
  ({ city }) => `教材模拟天气：${city}今天晴朗，气温 24°C。`,
  {
    name: "get_weather",
    description: "获取指定城市的天气信息",
    schema: z.object({
      city: z.string().min(1).describe("需要查询天气的城市名称"),
    }),
  },
);

/** 创建官方 Quickstart 风格的基础 Agent，并向它注册天气工具。 */
export function createQuickstartAgent(model = DEFAULT_QUICKSTART_MODEL) {
  return createAgent({
    model,
    tools: [getWeather],
  });
}
