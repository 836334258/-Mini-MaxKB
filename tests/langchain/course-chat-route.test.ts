import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../../app/api/langchain-course/chat/route";

test("LC8 Route Handler 拒绝无效 JSON 和空消息", async () => {
  const invalidJsonResponse = await POST(
    new Request("http://localhost/api/langchain-course/chat", {
      method: "POST",
      body: "{invalid",
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(invalidJsonResponse.status, 400);

  const emptyMessageResponse = await POST(
    new Request("http://localhost/api/langchain-course/chat", {
      method: "POST",
      body: JSON.stringify({ message: "   " }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(emptyMessageResponse.status, 400);
  assert.deepEqual(await emptyMessageResponse.json(), {
    error: "message 不能为空",
  });

  const nonObjectResponse = await POST(
    new Request("http://localhost/api/langchain-course/chat", {
      method: "POST",
      body: "null",
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(nonObjectResponse.status, 400);
  assert.deepEqual(await nonObjectResponse.json(), {
    error: "请求体必须是 JSON 对象",
  });

  const wrongTypeResponse = await POST(
    new Request("http://localhost/api/langchain-course/chat", {
      method: "POST",
      body: JSON.stringify({ message: 123 }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(wrongTypeResponse.status, 400);
});
