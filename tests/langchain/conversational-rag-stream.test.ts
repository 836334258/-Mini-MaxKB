import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { AIMessage } from "@langchain/core/messages";
import {
  FakeListChatModel,
  FakeStreamingChatModel,
} from "@langchain/core/utils/testing";

import { streamConversationalRag } from "../../lib/langchain/conversational-rag";
import { createCourseRetriever } from "../../lib/langchain/course-retriever";
import type { CourseChunkMetadata } from "../../lib/langchain/document-processing";
import { buildCourseVectorStore } from "../../lib/langchain/semantic-search";

class StreamTestEmbeddings implements EmbeddingsInterface {
  async embedDocuments(documents: string[]) {
    return documents.map((document) => [
      /Embedding|向量|索引/.test(document) ? 1 : 0,
    ]);
  }

  async embedQuery(query: string) {
    return [/Embedding|向量|索引/.test(query) ? 1 : 0];
  }
}

test("LC8 流式 RAG 按改写、来源、增量和完成的顺序产出事件", async () => {
  const chunk = new Document<CourseChunkMetadata>({
    id: "model.md#chunk-0",
    pageContent: "更换 Embedding 模型后需要重新向量化并重建索引。",
    metadata: {
      source: "model.md",
      title: "模型管理",
      fileType: "markdown",
      chunkIndex: 0,
      chunkCount: 1,
    },
  });
  const vectorStore = await buildCourseVectorStore(
    [chunk],
    new StreamTestEmbeddings(),
  );
  const retriever = createCourseRetriever(vectorStore, { k: 1 });
  const events = [];

  for await (const event of streamConversationalRag(
    retriever,
    {
      queryModel: new FakeListChatModel({
        responses: ["为什么更换 Embedding 模型后要重建索引？"],
      }),
      answerModel: new FakeStreamingChatModel({
        responses: [new AIMessage("因为旧向量不能继续比较 [资料 1]")],
        sleep: 0,
      }),
    },
    {
      question: "为什么？",
      history: [
        {
          question: "更换 Embedding 模型后要做什么？",
          answer: "需要重建索引。",
        },
      ],
    },
  )) {
    events.push(event);
  }

  assert.equal(events[0].type, "rewrite");
  assert.equal(events[1].type, "sources");
  assert.ok(events.slice(2, -1).every((event) => event.type === "delta"));
  assert.equal(events.at(-1)?.type, "done");

  const streamedAnswer = events
    .filter((event) => event.type === "delta")
    .map((event) => event.content)
    .join("");
  assert.equal(streamedAnswer, "因为旧向量不能继续比较 [资料 1]");

  const doneEvent = events.at(-1);
  assert.equal(doneEvent?.type, "done");
  if (doneEvent?.type === "done") {
    assert.equal(doneEvent.result.answer, streamedAnswer);
    assert.equal(doneEvent.result.sources[0].id, "model.md#chunk-0");
  }
});
