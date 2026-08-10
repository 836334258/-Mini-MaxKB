import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRetrieval } from "../../lib/evaluation/retrieval-evaluation";

test("检索评测同时计算知识命中和越界拒答", () => {
  const report = evaluateRetrieval(
    [
      {
        id: "model",
        query: "向量模型",
        expectedSources: ["model.md"],
      },
      {
        id: "weather",
        query: "火星天气",
        expectedSources: [],
      },
    ],
    [
      [1, 0],
      [-1, -1],
    ],
    [
      {
        id: "model.md#0",
        source: "model.md",
        title: "模型",
        position: 0,
        content: "向量模型变更后需要重建索引。",
        vector: [1, 0],
      },
    ],
    { topK: 1, candidateK: 1, minScore: 0.45, semanticWeight: 0.7 },
  );

  assert.equal(report.hitAtK, 1);
  assert.equal(report.meanReciprocalRank, 1);
  assert.equal(report.rejectionAccuracy, 1);
  assert.equal(report.items[1].rejected, true);
});
