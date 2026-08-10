import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";

import {
  loadTextDocument,
  splitCourseDocument,
  type CourseDocumentMetadata,
} from "../../lib/langchain/document-processing";

test("LC2 Loader 把本地 Markdown 转换成带来源信息的 Document", async () => {
  const document = await loadTextDocument(
    "data/l1-documents/learning-path.md",
  );

  assert.equal(document.id, "data/l1-documents/learning-path.md");
  assert.equal(document.metadata.source, document.id);
  assert.equal(document.metadata.title, "Mini-MaxKB 学习路线");
  assert.equal(document.metadata.fileType, "markdown");
  assert.match(document.pageContent, /L2 会把 L1 检索出的文档片段加入提示词/);
});

test("LC2 Splitter 保留原 metadata，并给每个 chunk 增加追踪字段", async () => {
  const document = new Document<CourseDocumentMetadata>({
    id: "course.md",
    pageContent:
      "第一段介绍文档加载。它负责把不同来源统一成 Document。\n\n" +
      "第二段介绍递归切块。它优先保持段落和句子的完整性。\n\n" +
      "第三段介绍 metadata。它让检索结果能够追溯到原始资料。",
    metadata: {
      source: "course.md",
      title: "LC2 示例",
      fileType: "markdown",
    },
  });

  const chunks = await splitCourseDocument(document, {
    chunkSize: 38,
    chunkOverlap: 8,
  });

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.pageContent.length <= 38));
  assert.deepEqual(
    chunks.map((chunk) => chunk.id),
    chunks.map((_, index) => `course.md#chunk-${index}`),
  );

  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.metadata.source, "course.md");
    assert.equal(chunk.metadata.title, "LC2 示例");
    assert.equal(chunk.metadata.chunkIndex, index);
    assert.equal(chunk.metadata.chunkCount, chunks.length);
    assert.ok(chunk.metadata.loc?.lines);
  }
});

test("LC2 Splitter 拒绝会导致无效重叠的参数", async () => {
  const document = new Document<CourseDocumentMetadata>({
    pageContent: "测试内容",
    metadata: {
      source: "test.txt",
      title: "测试",
      fileType: "text",
    },
  });

  await assert.rejects(
    splitCourseDocument(document, { chunkSize: 20, chunkOverlap: 20 }),
    /chunkSize > chunkOverlap >= 0/,
  );
});
