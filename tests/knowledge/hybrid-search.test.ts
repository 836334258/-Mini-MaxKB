import assert from "node:assert/strict";
import test from "node:test";

import { searchChunksHybrid } from "../../lib/knowledge/hybrid-search";
import { tokenizeForSearch } from "../../lib/knowledge/keyword-search";
import type { IndexedChunk } from "../../lib/knowledge/vector-index";

const chunks: IndexedChunk[] = [
  {
    id: "security.md#0",
    source: "security.md",
    title: "安全",
    position: 0,
    content: "密钥只能放在服务端。",
    vector: [1, 0],
  },
  {
    id: "model.md#0",
    source: "model.md",
    title: "模型管理",
    position: 0,
    content: "Embedding 向量模型变更后必须重建索引。",
    vector: [0.8, 0.2],
  },
];

test("中英文分词保留 API 单词并生成中文二元词组", () => {
  const tokens = tokenizeForSearch("API Key 与向量模型");

  assert.ok(tokens.includes("api"));
  assert.ok(tokens.includes("key"));
  assert.ok(tokens.includes("向量"));
  assert.ok(tokens.includes("模型"));
});

test("关键词信号可以把精确术语文档提升到语义第一名之前", () => {
  const response = searchChunksHybrid(
    "Embedding 向量模型如何更新",
    [1, 0],
    chunks,
    { topK: 2, candidateK: 2, minScore: 0, semanticWeight: 0.4 },
  );

  assert.equal(response.results[0].chunk.id, "model.md#0");
  assert.equal(response.results[0].keywordScore, 1);
  assert.equal(response.diagnostics.strategy, "hybrid");
});

test("语义和关键词都不相关时被最低分阈值拦截", () => {
  const response = searchChunksHybrid(
    "火星天气预报",
    [-1, -1],
    chunks,
    { topK: 2, candidateK: 2, minScore: 0.45, semanticWeight: 0.7 },
  );

  assert.deepEqual(response.results, []);
  assert.equal(response.diagnostics.rejected, true);
  assert.equal(response.diagnostics.returnedCount, 0);
});
