import assert from "node:assert/strict";
import test from "node:test";

import { Document } from "@langchain/core/documents";

import { evaluateCourseRetrieval } from "../../lib/langchain/course-evaluation";
import type { CourseSearchResult } from "../../lib/langchain/semantic-search";

/** 创建不需要真实 Embedding API 的确定性检索结果。 */
function result(source: string, score: number): CourseSearchResult {
  return {
    document: new Document({
      pageContent: source,
      metadata: {
        source,
        title: source,
        fileType: "markdown",
        chunkIndex: 0,
        chunkCount: 1,
      },
    }),
    score,
  };
}

test("LC12 同时计算 Hit@K、MRR 和越界拒答准确率", async () => {
  const responses = new Map<string, CourseSearchResult[]>([
    ["模型问题", [result("other.md", 0.9), result("model.md", 0.8)]],
    ["天气问题", [result("model.md", 0.3)]],
  ]);
  const report = await evaluateCourseRetrieval(
    [
      {
        id: "model",
        query: "模型问题",
        expectedSources: ["model.md"],
      },
      { id: "weather", query: "天气问题", expectedSources: [] },
    ],
    async (query) => responses.get(query) ?? [],
    { k: 2, minScore: 0.6 },
  );

  assert.equal(report.hitAtK, 1);
  assert.equal(report.meanReciprocalRank, 0.5);
  assert.equal(report.rejectionAccuracy, 1);
  assert.equal(report.items[1]?.rejected, true);
});

test("LC12 评估拒绝空数据集和无效参数", async () => {
  await assert.rejects(
    evaluateCourseRetrieval([], async () => [], { k: 2, minScore: 0.6 }),
    /不能为空/,
  );
  await assert.rejects(
    evaluateCourseRetrieval(
      [{ id: "x", query: "x", expectedSources: [] }],
      async () => [],
      { k: 0, minScore: 0.6 },
    ),
    /正整数/,
  );
});
