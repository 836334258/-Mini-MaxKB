import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import {
  createCourseRetriever,
  invokeCourseRetriever,
} from "../../lib/langchain/course-retriever";
import type { CourseChunkMetadata } from "../../lib/langchain/document-processing";
import { buildCourseVectorStore } from "../../lib/langchain/semantic-search";

/** 用固定关键词生成三维向量，避免 Retriever 测试依赖真实 API。 */
class RetrieverTestEmbeddings implements EmbeddingsInterface {
  private vectorize(text: string) {
    return [
      /安全|API Key|服务端/.test(text) ? 1 : 0,
      /Embedding|向量|索引/.test(text) ? 1 : 0,
      /RAG|回答|提示词/.test(text) ? 1 : 0,
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
  id: string,
  source: string,
  pageContent: string,
): Document<CourseChunkMetadata> {
  return new Document({
    id,
    pageContent,
    metadata: {
      source,
      title: source,
      fileType: "markdown",
      chunkIndex: 0,
      chunkCount: 1,
    },
  });
}

test("LC4 Retriever.invoke() 按 k 返回最相关 Documents", async () => {
  const vectorStore = await buildCourseVectorStore(
    [
      createChunk("security#0", "security.md", "API Key 只能保存在服务端。"),
      createChunk("model#0", "model.md", "Embedding 模型负责生成向量索引。"),
      createChunk("rag#0", "rag.md", "RAG 把检索内容加入提示词生成回答。"),
    ],
    new RetrieverTestEmbeddings(),
  );
  const retriever = createCourseRetriever(vectorStore, { k: 1 });

  const documents = await invokeCourseRetriever(
    retriever,
    "API Key 怎样安全保存？",
  );

  assert.equal(documents.length, 1);
  assert.equal(documents[0].id, "security#0");
  assert.equal(documents[0].metadata.source, "security.md");
});

test("LC4 metadata filter 会在相似度搜索前限制来源", async () => {
  const vectorStore = await buildCourseVectorStore(
    [
      createChunk("security#0", "security.md", "API Key 只能保存在服务端。"),
      createChunk("model#0", "model.md", "模型服务端也需要配置 API Key。"),
    ],
    new RetrieverTestEmbeddings(),
  );
  const retriever = createCourseRetriever(vectorStore, {
    k: 2,
    source: "model.md",
  });

  const documents = await invokeCourseRetriever(retriever, "API Key 放在哪里？");

  assert.equal(documents.length, 1);
  assert.equal(documents[0].metadata.source, "model.md");
});

test("LC4 Retriever 拒绝无效 k 和空查询", async () => {
  const vectorStore = await buildCourseVectorStore(
    [createChunk("security#0", "security.md", "API Key 安全")],
    new RetrieverTestEmbeddings(),
  );

  assert.throws(() => createCourseRetriever(vectorStore, { k: 0 }), /正整数/);
  const retriever = createCourseRetriever(vectorStore);
  await assert.rejects(invokeCourseRetriever(retriever, "   "), /不能为空/);
});
