import assert from "node:assert/strict";
import test from "node:test";

import {
  CourseObservabilityRepository,
  percentile95,
  toDurationMs,
} from "../../lib/langchain/course-observability";

test("LC12 运行仓库保存成功和错误阶段并计算汇总", () => {
  const repository = new CourseObservabilityRepository(":memory:");

  try {
    repository.recordRun({
      conversationId: "conversation-1",
      provider: "google-genai",
      model: "gemini-test",
      status: "success",
      sourceCount: 2,
      retrievalMs: 100.4,
      generationMs: 400.4,
      totalMs: 550.6,
    });
    repository.recordRun({
      provider: "deepseek",
      model: "deepseek-test",
      status: "error",
      sourceCount: 0,
      retrievalMs: 0,
      generationMs: 0,
      totalMs: 22,
      errorStage: "configuration",
      errorMessage: "测试错误",
    });

    const runs = repository.listRecentRuns();
    const summary = repository.summarizeRecentRuns();
    const errorRun = runs.find((run) => run.status === "error");

    assert.equal(runs.length, 2);
    assert.equal(errorRun?.errorStage, "configuration");
    assert.deepEqual(summary, {
      totalRuns: 2,
      successRuns: 1,
      errorRuns: 1,
      averageRetrievalMs: 100,
      averageGenerationMs: 400,
      averageTotalMs: 551,
      p95TotalMs: 551,
    });
  } finally {
    repository.close();
  }
});

test("LC12 耗时归一化和 P95 使用确定性算法", () => {
  assert.equal(toDurationMs(10.6), 11);
  assert.equal(toDurationMs(-2), 0);
  assert.equal(percentile95([]), 0);
  assert.equal(percentile95([10, 20, 30, 40, 100]), 100);
});
