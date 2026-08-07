import assert from "node:assert/strict";
import test from "node:test";

import { GeminiEmbeddingProvider } from "../../lib/ai/providers/gemini-embedding";
import type { Fetcher } from "../../lib/ai/types";
import { chunkDocument } from "../../lib/knowledge/chunker";
import {
  cosineSimilarity,
  searchChunks,
} from "../../lib/knowledge/semantic-search";

test("文档按空行聚合并切分过长段落", () => {
  const chunks = chunkDocument(
    {
      source: "guide.md",
      title: "指南",
      content: `第一段。\n\n第二段内容。\n\n${"长".repeat(25)}`,
    },
    { maxCharacters: 20, overlapCharacters: 5 },
  );

  assert.deepEqual(
    chunks.map((chunk) => chunk.content),
    ["第一段。\n\n第二段内容。", "长".repeat(20), "长".repeat(10)],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.id),
    ["guide.md#0", "guide.md#1", "guide.md#2"],
  );
});

test("余弦相似度排序返回最接近的分段", () => {
  const chunks = [
    {
      id: "a#0",
      source: "a.md",
      title: "A",
      position: 0,
      content: "模型切换",
      vector: [1, 0],
    },
    {
      id: "b#0",
      source: "b.md",
      title: "B",
      position: 0,
      content: "文档上传",
      vector: [0, 1],
    },
  ];

  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(searchChunks([0.9, 0.1], chunks, 1)[0].chunk.id, "a#0");
});

test("Gemini Embedding 2 使用检索前缀并归一化批量响应", async () => {
  let capturedUrl = "";
  let capturedBody: unknown;
  const fetcher: Fetcher = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ embeddings: [{ values: [1, 0] }, { values: [0, 1] }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const provider = new GeminiEmbeddingProvider({
    apiKey: "secret",
    model: "gemini-embedding-2",
    dimensions: 2,
    fetcher,
  });
  const result = await provider.embed({
    purpose: "document",
    inputs: [
      { title: "模型", text: "支持切换模型" },
      { text: "知识库检索" },
    ],
  });

  assert.equal(
    capturedUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
  );
  assert.deepEqual(capturedBody, {
    requests: [
      {
        model: "models/gemini-embedding-2",
        content: {
          parts: [{ text: "title: 模型 | text: 支持切换模型" }],
        },
        outputDimensionality: 2,
      },
      {
        model: "models/gemini-embedding-2",
        content: {
          parts: [{ text: "title: none | text: 知识库检索" }],
        },
        outputDimensionality: 2,
      },
    ],
  });
  assert.deepEqual(result.vectors, [
    [1, 0],
    [0, 1],
  ]);
});
