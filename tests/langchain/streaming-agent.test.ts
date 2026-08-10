import assert from "node:assert/strict";
import test from "node:test";

import { FakeToolCallingModel } from "langchain";

import { createThreadConfig } from "../../lib/langchain/memory-agent";
import { createStreamingWeatherAgent } from "../../lib/langchain/streaming-agent";

test("LC1D v3 事件流分别暴露模型消息、工具调用和最终状态", async () => {
  const model = new FakeToolCallingModel({
    toolCalls: [
      [
        {
          name: "get_weather",
          args: { city: "上海" },
          id: "weather-call-1",
        },
      ],
      [],
    ],
  });
  const agent = createStreamingWeatherAgent(model);
  const run = await agent.streamEvents(
    { messages: [{ role: "user", content: "上海天气怎么样？" }] },
    { ...createThreadConfig("lc1d-test"), version: "v3" },
  );
  const streamedMessages: string[] = [];
  const toolCalls: Array<{
    name: string;
    input: unknown;
    output: unknown;
    status: string;
  }> = [];

  await Promise.all([
    (async () => {
      for await (const message of run.messages) {
        streamedMessages.push(await message.text);
      }
    })(),
    (async () => {
      for await (const call of run.toolCalls) {
        toolCalls.push({
          name: call.name,
          input: call.input,
          output: await call.output,
          status: await call.status,
        });
      }
    })(),
  ]);

  const finalState = await run.output;

  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]?.name, "get_weather");
  assert.deepEqual(toolCalls[0]?.input, { city: "上海" });
  assert.equal(toolCalls[0]?.status, "finished");
  assert.match(String(toolCalls[0]?.output), /上海今天晴朗/);
  assert.match(streamedMessages.join(""), /上海今天晴朗/);
  assert.ok(finalState.messages.some((message) => message.getType() === "tool"));
});

test("LC1D 旧 streamMode 兼容路径仍能完成工具后的模型回答", async () => {
  const model = new FakeToolCallingModel({
    toolCalls: [
      [
        {
          name: "get_weather",
          args: { city: "北京" },
          id: "weather-call-legacy",
        },
      ],
      [],
    ],
  });
  const agent = createStreamingWeatherAgent(model);
  const stream = await agent.stream(
    { messages: [{ role: "user", content: "北京天气怎么样？" }] },
    {
      ...createThreadConfig("lc1d-legacy-test"),
      streamMode: ["updates", "messages"],
    },
  );
  const observedModes = new Set<string>();
  let streamedText = "";

  for await (const rawChunk of stream) {
    const [mode, chunk] = rawChunk as [string, unknown];
    observedModes.add(mode);
    if (mode !== "messages" || !Array.isArray(chunk)) {
      continue;
    }
    const message = chunk[0];
    if (
      typeof message === "object" &&
      message !== null &&
      "content" in message &&
      typeof message.content === "string"
    ) {
      streamedText += message.content;
    }
  }

  assert.deepEqual(observedModes, new Set(["messages", "updates"]));
  assert.match(streamedText, /北京今天晴朗/);
});
