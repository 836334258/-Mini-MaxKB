import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { FakeChatModel, FakeListChatModel } from "@langchain/core/utils/testing";

import {
  conversationTurnsToMessages,
  createConversationalRagChain,
  MAX_CONVERSATION_HISTORY_TURNS,
} from "../../lib/langchain/conversational-rag";
import { createCourseRetriever } from "../../lib/langchain/course-retriever";
import type { CourseChunkMetadata } from "../../lib/langchain/document-processing";
import { buildCourseVectorStore } from "../../lib/langchain/semantic-search";

/** 为模型管理和 API 安全主题生成确定性的二维向量。 */
class ConversationTestEmbeddings implements EmbeddingsInterface {
  private vectorize(text: string) {
    return [
      /Embedding|向量|索引|重建/.test(text) ? 1 : 0,
      /API Key|服务端|安全/.test(text) ? 1 : 0,
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

async function createTestRetriever() {
  const vectorStore = await buildCourseVectorStore(
    [
      createChunk(
        "model#0",
        "model.md",
        "更换 Embedding 模型后，旧向量不能继续比较，必须重建索引。",
      ),
      createChunk("security#0", "security.md", "API Key 只能保存在服务端。"),
    ],
    new ConversationTestEmbeddings(),
  );

  return createCourseRetriever(vectorStore, { k: 1 });
}

test("LC6 没有历史时直接使用原问题，不调用问题改写模型", async () => {
  const queryModel = new FakeListChatModel({
    responses: ["不应该被调用"],
  });
  const answerModel = new FakeListChatModel({
    responses: ["需要重建索引 [资料 1]"],
  });
  const ragChain = createConversationalRagChain(await createTestRetriever(), {
    queryModel,
    answerModel,
  });

  const result = await ragChain.invoke({
    question: "更换 Embedding 模型后需要做什么？",
  });

  assert.equal(
    result.standaloneQuestion,
    "更换 Embedding 模型后需要做什么？",
  );
  assert.equal(result.answer, "需要重建索引 [资料 1]");
  assert.equal(queryModel.i, 0);
});

test("LC6 模糊追问会先改写，再用独立问题检索并携带历史回答", async () => {
  const retriever = await createTestRetriever();
  const queryModel = new FakeListChatModel({
    responses: ["为什么更换 Embedding 模型后必须重建向量索引？"],
  });
  const ragChain = createConversationalRagChain(retriever, {
    queryModel,
    answerModel: new FakeChatModel({}),
  });

  const result = await ragChain.invoke({
    question: "为什么必须这样做？",
    history: [
      {
        question: "更换 Embedding 模型后需要做什么？",
        answer: "需要重新向量化全部文档并重建索引 [资料 1]。",
      },
    ],
  });

  assert.equal(
    result.standaloneQuestion,
    "为什么更换 Embedding 模型后必须重建向量索引？",
  );
  assert.equal(result.sources[0].id, "model#0");
  assert.match(result.answer, /更换 Embedding 模型后需要做什么/);
  assert.match(result.answer, /需要重新向量化全部文档并重建索引/);
  assert.match(result.answer, /为什么必须这样做/);
  assert.match(result.answer, /source: model\.md/);
  assert.doesNotMatch(result.answer, /API Key 只能保存在服务端/);
});

test("LC6 只把最近六轮有效历史转换成 human/ai 消息", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    question: `问题 ${index + 1}`,
    answer: `回答 ${index + 1}`,
  }));
  const messages = conversationTurnsToMessages(history);

  assert.equal(messages.length, MAX_CONVERSATION_HISTORY_TURNS * 2);
  assert.equal(messages[0].content, "问题 3");
  assert.equal(messages.at(-1)?.content, "回答 8");
  assert.equal(messages[0].getType(), "human");
  assert.equal(messages[1].getType(), "ai");
});

test("LC6 拒绝空问题和不完整历史", async () => {
  const ragChain = createConversationalRagChain(await createTestRetriever(), {
    answerModel: new FakeChatModel({}),
  });

  await assert.rejects(ragChain.invoke({ question: "   " }), /不能为空/);
  await assert.rejects(
    ragChain.invoke({
      question: "为什么？",
      history: [{ question: "上一题", answer: "   " }],
    }),
    /历史的问题和回答不能为空/,
  );
});
