import assert from "node:assert/strict";
import test from "node:test";

import type { EmbeddingProvider } from "../../lib/ai/embedding-types";
import type { ChatProvider, ChatRequest } from "../../lib/ai/types";
import { askKnowledgeBase } from "../../lib/rag/rag-service";
import type { VectorIndex } from "../../lib/knowledge/vector-index";

test("RAG 先检索最相关分段，再要求聊天模型引用该来源", async () => {
  let capturedChatRequest: ChatRequest | undefined;
  const embeddingProvider: EmbeddingProvider = {
    id: "gemini",
    model: "embedding-test",
    dimensions: 2,
    async embed(request) {
      assert.equal(request.purpose, "query");
      assert.deepEqual(request.inputs, [{ text: "如何切换模型？" }]);
      return {
        provider: "gemini",
        model: "embedding-test",
        dimensions: 2,
        vectors: [[1, 0]],
      };
    },
  };
  const chatProvider: ChatProvider = {
    id: "deepseek",
    model: "chat-test",
    async chat(request) {
      capturedChatRequest = request;
      return {
        provider: "deepseek",
        model: "chat-test",
        content: "修改配置即可切换聊天模型。[1]",
      };
    },
  };
  const index: VectorIndex = {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    embedding: {
      provider: "gemini",
      model: "embedding-test",
      dimensions: 2,
    },
    chunks: [
      {
        id: "models.md#0",
        source: "models.md",
        title: "模型管理",
        position: 0,
        content: "聊天模型可以通过配置切换。",
        vector: [1, 0],
      },
      {
        id: "security.md#0",
        source: "security.md",
        title: "安全",
        position: 0,
        content: "密钥只能保存在服务端。",
        vector: [0, 1],
      },
    ],
  };

  const result = await askKnowledgeBase(
    { chatProvider, embeddingProvider, index },
    {
      question: "如何切换模型？",
      topK: 1,
      history: [
        { role: "user", content: "我们正在讨论模型管理。" },
        { role: "assistant", content: "好的，请继续提问。" },
      ],
    },
  );

  assert.equal(result.response.content, "修改配置即可切换聊天模型。[1]");
  assert.equal(result.grounded, true);
  assert.equal(result.diagnostics.strategy, "semantic");
  assert.deepEqual(
    result.sources.map((source) => source.chunk.id),
    ["models.md#0"],
  );
  assert.equal(capturedChatRequest?.temperature, 0.2);
  assert.match(capturedChatRequest?.messages[0].content ?? "", /只能根据/);
  assert.equal(capturedChatRequest?.messages[1].content, "我们正在讨论模型管理。");
  assert.equal(capturedChatRequest?.messages[2].content, "好的，请继续提问。");
  assert.match(capturedChatRequest?.messages[3].content ?? "", /\[1\]/);
  assert.match(capturedChatRequest?.messages[3].content ?? "", /模型管理/);
  assert.doesNotMatch(capturedChatRequest?.messages[3].content ?? "", /密钥只能/);
});

test("空问题不会调用模型", async () => {
  const unavailable = () => {
    throw new Error("不应该调用模型");
  };

  await assert.rejects(
    askKnowledgeBase(
      {
        chatProvider: {
          id: "deepseek",
          model: "chat-test",
          chat: unavailable,
        },
        embeddingProvider: {
          id: "gemini",
          model: "embedding-test",
          dimensions: 2,
          embed: unavailable,
        },
        index: {
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          embedding: { provider: "gemini", model: "embedding-test", dimensions: 2 },
          chunks: [],
        },
      },
      { question: "   " },
    ),
    /问题不能为空/,
  );
});
