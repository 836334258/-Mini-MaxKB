import assert from "node:assert/strict";
import test from "node:test";

import { FakeToolCallingModel } from "langchain";

import {
  createMemoryAgent,
  createThreadConfig,
} from "../../lib/langchain/memory-agent";

test("LC1C thread_id 会去除两端空格并拒绝空值", () => {
  assert.deepEqual(createThreadConfig("  user-a  "), {
    configurable: { thread_id: "user-a" },
  });
  assert.throws(() => createThreadConfig("   "), /thread_id 不能为空/);
});

test("LC1C 相同 thread_id 续接消息，不同 thread_id 彼此隔离", async () => {
  const agent = createMemoryAgent(new FakeToolCallingModel());
  const threadA = createThreadConfig("thread-a");
  const threadB = createThreadConfig("thread-b");

  await agent.invoke(
    {
      messages: [{ role: "user", content: "请记住课程编号 LC1C-A17" }],
    },
    threadA,
  );

  const sameThreadResult = await agent.invoke(
    {
      messages: [{ role: "user", content: "课程编号是什么？" }],
    },
    threadA,
  );
  const isolatedThreadResult = await agent.invoke(
    {
      messages: [{ role: "user", content: "课程编号是什么？" }],
    },
    threadB,
  );

  assert.ok(
    sameThreadResult.messages.length > isolatedThreadResult.messages.length,
  );
  const sameThreadAiMessage = sameThreadResult.messages.find(
    (message) => message.getType() === "ai",
  );
  const isolatedThreadAiMessage = isolatedThreadResult.messages.find(
    (message) => message.getType() === "ai",
  );

  assert.match(sameThreadAiMessage?.text ?? "", /LC1C-A17/);
  assert.equal(isolatedThreadResult.messages.length, 2);
  assert.doesNotMatch(isolatedThreadAiMessage?.text ?? "", /LC1C-A17/);
});
