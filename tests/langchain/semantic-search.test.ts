import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import type {
  EmbeddingProvider,
  EmbeddingRequest,
} from "../../lib/ai/embedding-types";
import type { CourseChunkMetadata } from "../../lib/langchain/document-processing";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
  searchCourseVectorStore,
} from "../../lib/langchain/semantic-search";

/**
 * 用关键词生成固定的三维向量，让测试不调用真实 API 也能验证语义排序流程。
 */
class LessonEmbeddings implements EmbeddingsInterface {
  private vectorize(text: string) {
    return [
      /Embedding|语义搜索|语义检索/.test(text) ? 1 : 0,
      /RAG|提示词|回答/.test(text) ? 1 : 0,
      /模型 API|Gemini|DeepSeek/.test(text) ? 1 : 0,
    ];
  }

  async embedDocuments(documents: string[]) {
    return documents.map((document) => this.vectorize(document));
  }

  async embedQuery(query: string) {
    return this.vectorize(query);
  }
}

function createChunk(
  chunkIndex: number,
  pageContent: string,
): Document<CourseChunkMetadata> {
  return new Document({
    id: `course.md#chunk-${chunkIndex}`,
    pageContent,
    metadata: {
      source: "course.md",
      title: "学习路线",
      fileType: "markdown",
      chunkIndex,
      chunkCount: 3,
    },
  });
}

test("LC3 Adapter 分别使用 document 和 query 两种 Embedding 目的", async () => {
  const requests: EmbeddingRequest[] = [];
  const provider: EmbeddingProvider = {
    id: "gemini",
    model: "test-embedding",
    dimensions: 2,
    async embed(request) {
      requests.push(request);
      return {
        provider: "gemini",
        model: "test-embedding",
        dimensions: 2,
        vectors: request.inputs.map((_, index) => [index + 1, 0]),
      };
    },
  };
  const adapter = new LangChainEmbeddingsAdapter(provider);

  assert.deepEqual(await adapter.embedDocuments(["片段 A", "片段 B"]), [
    [1, 0],
    [2, 0],
  ]);
  assert.deepEqual(await adapter.embedQuery("用户问题"), [1, 0]);
  assert.deepEqual(
    requests.map((request) => request.purpose),
    ["document", "query"],
  );
});

test("LC3 语义搜索把与问题最接近的小 Document 排在第一位", async () => {
  const chunks = [
    createChunk(0, "L0 学习模型 API，调用 Gemini 或 DeepSeek。"),
    createChunk(1, "L1 学习 Embedding、余弦相似度和语义搜索。"),
    createChunk(2, "L2 把检索片段加入提示词，让模型生成 RAG 回答。"),
  ];
  const vectorStore = await buildCourseVectorStore(
    chunks,
    new LessonEmbeddings(),
  );

  const results = await searchCourseVectorStore(
    vectorStore,
    "怎样进行语义检索？",
    2,
  );

  assert.equal(vectorStore.memoryVectors.length, 3);
  assert.equal(results.length, 2);
  assert.equal(results[0].document.id, "course.md#chunk-1");
  assert.equal(results[0].score, 1);
  assert.equal(results[0].document.metadata.chunkIndex, 1);
});

test("LC3 拒绝空问题和无效 top-k", async () => {
  const vectorStore = await buildCourseVectorStore(
    [createChunk(0, "语义搜索")],
    new LessonEmbeddings(),
  );

  await assert.rejects(searchCourseVectorStore(vectorStore, "   "), /不能为空/);
  await assert.rejects(
    searchCourseVectorStore(vectorStore, "语义搜索", 0),
    /正整数/,
  );
});
