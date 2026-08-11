import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { FakeChatModel, FakeListChatModel } from "@langchain/core/utils/testing";

import { createCourseRetriever } from "../../lib/langchain/course-retriever";
import type { CourseChunkMetadata } from "../../lib/langchain/document-processing";
import {
  createCourseRagChain,
  EMPTY_CONTEXT_ANSWER,
  formatDocumentsAsContext,
} from "../../lib/langchain/rag-chain";
import { buildCourseVectorStore } from "../../lib/langchain/semantic-search";

/** 为离线测试生成可预测的模型管理、API 安全和 RAG 三维向量。 */
class RagTestEmbeddings implements EmbeddingsInterface {
  private vectorize(text: string) {
    return [
      /Embedding|向量|索引/.test(text) ? 1 : 0,
      /API Key|服务端|安全/.test(text) ? 1 : 0,
      /RAG|提示词|回答/.test(text) ? 1 : 0,
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

test("LC5 上下文格式同时包含编号、来源、chunk 和正文", () => {
  const context = formatDocumentsAsContext([
    createChunk("model#0", "model.md", "更换向量模型后需要重建索引。"),
  ]);

  assert.match(context, /^\[资料 1\]/);
  assert.match(context, /source: model\.md/);
  assert.match(context, /chunk: 0/);
  assert.match(context, /更换向量模型后需要重建索引/);
});

test("LC5 RAG Chain 把检索资料和问题一起送入 Prompt，并返回 sources", async () => {
  const vectorStore = await buildCourseVectorStore(
    [
      createChunk(
        "model#0",
        "model.md",
        "更换 Embedding 模型或向量维度后，必须重新向量化并重建索引。",
      ),
      createChunk("security#0", "security.md", "API Key 只能保存在服务端。"),
    ],
    new RagTestEmbeddings(),
  );
  const retriever = createCourseRetriever(vectorStore, { k: 1 });
  const ragChain = createCourseRagChain(retriever, new FakeChatModel({}));

  const result = await ragChain.invoke({
    question: "更换 Embedding 模型后需要做什么？",
  });

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, "model#0");
  assert.match(result.answer, /只能根据用户消息中/);
  assert.match(result.answer, /source: model\.md/);
  assert.match(result.answer, /重新向量化并重建索引/);
  assert.match(result.answer, /更换 Embedding 模型后需要做什么/);
  assert.doesNotMatch(result.answer, /API Key 只能保存在服务端/);
});

test("LC5 没有检索结果时不调用聊天模型", async () => {
  const vectorStore = await buildCourseVectorStore(
    [createChunk("model#0", "model.md", "Embedding 模型管理")],
    new RagTestEmbeddings(),
  );
  const retriever = createCourseRetriever(vectorStore, {
    source: "missing.md",
  });
  const model = new FakeListChatModel({ responses: ["不应该被调用"] });
  const ragChain = createCourseRagChain(retriever, model);

  const result = await ragChain.invoke({ question: "如何管理模型？" });

  assert.equal(result.answer, EMPTY_CONTEXT_ANSWER);
  assert.deepEqual(result.sources, []);
  assert.equal(model.i, 0);
});

test("LC5 拒绝空问题", async () => {
  const vectorStore = await buildCourseVectorStore(
    [createChunk("model#0", "model.md", "Embedding 模型管理")],
    new RagTestEmbeddings(),
  );
  const retriever = createCourseRetriever(vectorStore);
  const ragChain = createCourseRagChain(retriever, new FakeChatModel({}));

  await assert.rejects(ragChain.invoke({ question: "   " }), /不能为空/);
});
