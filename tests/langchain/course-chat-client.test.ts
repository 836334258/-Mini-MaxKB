import assert from "node:assert/strict";
import test from "node:test";

import { consumeCourseChatStream } from "../../lib/langchain/course-chat-client";
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
