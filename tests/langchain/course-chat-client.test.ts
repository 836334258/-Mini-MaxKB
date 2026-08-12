import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeCourseChatStream,
  fetchCourseConversations,
  fetchCourseObservability,
} from "../../lib/langchain/course-chat-client";
import type { CourseChatStreamEvent } from "../../lib/langchain/course-chat-stream";

/** 把字节按指定位置拆开，用来模拟真实网络不会遵守 JSON 行边界的情况。 */
function createChunkedResponse(text: string, cutPoints: number[]) {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  let start = 0;

  for (const end of [...cutPoints, bytes.length]) {
    chunks.push(bytes.slice(start, end));
    start = end;
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

test("LC9 客户端能跨字节块和中文边界还原 NDJSON 事件", async () => {
  const ndjson = [
    JSON.stringify({ type: "status", message: "正在检索课程知识库" }),
    JSON.stringify({ type: "delta", content: "你好，向量检索！" }),
    JSON.stringify({ type: "delta", content: "第二段" }),
  ].join("\n");
  const events: CourseChatStreamEvent[] = [];

  await consumeCourseChatStream(
    createChunkedResponse(ndjson, [1, 7, 19, 28, 44, 61]),
    (event) => events.push(event),
  );

  assert.deepEqual(events, [
    { type: "status", message: "正在检索课程知识库" },
    { type: "delta", content: "你好，向量检索！" },
    { type: "delta", content: "第二段" },
  ]);
});

test("LC9 客户端把非 2xx JSON 响应转换成异常", async () => {
  await assert.rejects(
    consumeCourseChatStream(
      Response.json({ error: "会话不存在" }, { status: 404 }),
      () => undefined,
    ),
    /会话不存在/,
  );
});

test("LC11 客户端读取轻量会话摘要列表", async () => {
  const requests: Array<{ input: string; cache?: RequestCache }> = [];
  const conversations = [
    {
      id: "conversation-1",
      title: "第一问",
      provider: "gemini" as const,
      model: "gemini-test",
      knowledgeBaseId: "langchain-course",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:01:00.000Z",
    },
  ];

  const result = await fetchCourseConversations(async (input, init) => {
    requests.push({ input: String(input), cache: init?.cache });
    return Response.json({ conversations });
  });

  assert.deepEqual(result, conversations);
  assert.deepEqual(requests, [
    {
      input: "/api/langchain-course/conversations",
      cache: "no-store",
    },
  ]);
});

test("LC12 客户端使用 no-store 读取本地观测汇总", async () => {
  const summary = {
    totalRuns: 1,
    successRuns: 1,
    errorRuns: 0,
    averageRetrievalMs: 100,
    averageGenerationMs: 500,
    averageTotalMs: 650,
    p95TotalMs: 650,
  };
  const payload = await fetchCourseObservability(async (input, init) => {
    assert.equal(input, "/api/langchain-course/observability");
    assert.equal(init?.cache, "no-store");
    return Response.json({ summary, recentRuns: [] });
  });

  assert.deepEqual(payload, { summary, recentRuns: [] });
});
