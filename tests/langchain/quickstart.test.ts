import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_QUICKSTART_MODEL,
  getWeather,
} from "../../lib/langchain/quickstart-agent";

test("LC0 天气工具公开稳定名称并校验城市参数", async () => {
  assert.equal(getWeather.name, "get_weather");
  assert.equal(DEFAULT_QUICKSTART_MODEL, "google-genai:gemini-3.5-flash");
  assert.equal(
    await getWeather.invoke({ city: "上海" }),
    "教材模拟天气：上海今天晴朗，气温 24°C。",
  );

  await assert.rejects(() => getWeather.invoke({ city: "" }));
});
