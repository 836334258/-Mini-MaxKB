import assert from "node:assert/strict";
import test from "node:test";

import type { EmbeddingProvider } from "../../lib/ai/embedding-types";
import type { ChatProvider } from "../../lib/ai/types";
import { askKnowledgeBase } from "../../lib/rag/rag-service";

test("低相关度问题直接可靠拒答，不调用聊天模型", async () => {
  let chatCalled = false;
  const embeddingProvider: EmbeddingProvider = {
    id: "gemini",
    model: "embedding-test",
    dimensions: 2,
    async embed() {
      return {
        provider: "gemini",
        model: "embedding-test",
        dimensions: 2,
        vectors: [[-1, -1]],
      };
    },
  };
  const chatProvider: ChatProvider = {
    id: "deepseek",
    model: "chat-test",
    async chat() {
      chatCalled = true;
      throw new Error("不应该调用聊天模型");
    },
  };

  const result = await askKnowledgeBase(
    {
      chatProvider,
      embeddingProvider,
      index: {
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        embedding: {
          provider: "gemini",
          model: "embedding-test",
          dimensions: 2,
        },
        chunks: [
          {
            id: "security.md#0",
            source: "security.md",
            title: "安全",
            position: 0,
            content: "API Key 只能放在服务端。",
            vector: [1, 0],
          },
        ],
      },
    },
    {
      question: "火星天气怎么样？",
      retrieval: {
        topK: 3,
        candidateK: 12,
        minScore: 0.45,
        semanticWeight: 0.7,
      },
    },
  );

  assert.equal(chatCalled, false);
  assert.equal(result.grounded, false);
  assert.equal(result.diagnostics.rejected, true);
  assert.deepEqual(result.sources, []);
  assert.match(result.response.content, /没有检索到足够相关/);
});
