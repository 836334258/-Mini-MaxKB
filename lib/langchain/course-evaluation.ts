import type { CourseSearchResult } from "./semantic-search";

export interface CourseEvaluationCase {
  id: string;
  query: string;
  expectedSources: string[];
}

export interface CourseEvaluationOptions {
  k: number;
  minScore: number;
}

export interface CourseEvaluationItem {
  id: string;
  query: string;
  expectedSources: string[];
  retrievedSources: string[];
  topScore?: number;
  expectedRejection: boolean;
  rejected: boolean;
  hit: boolean;
  reciprocalRank: number;
}

export interface CourseEvaluationReport {
  items: CourseEvaluationItem[];
  positiveCases: number;
  rejectionCases: number;
  hitAtK: number;
  meanReciprocalRank: number;
  rejectionAccuracy: number;
}

/** 检查评测参数，避免无效阈值产生看似正常的指标。 */
function validateEvaluationOptions(options: CourseEvaluationOptions) {
  if (!Number.isInteger(options.k) || options.k <= 0) {
    throw new Error("评测 k 必须是正整数");
  }
  if (!Number.isFinite(options.minScore) || options.minScore < -1 || options.minScore > 1) {
    throw new Error("评测 minScore 必须在 -1 到 1 之间");
  }
}

/**
 * 对固定标注集执行课程向量检索并计算 Hit@K、MRR 和拒答准确率。
 * expectedSources 为空代表该问题应该因越界而被拒答。
 */
export async function evaluateCourseRetrieval(
  cases: CourseEvaluationCase[],
  search: (query: string, k: number) => Promise<CourseSearchResult[]>,
  options: CourseEvaluationOptions,
): Promise<CourseEvaluationReport> {
  validateEvaluationOptions(options);
  if (cases.length === 0) {
    throw new Error("课程评测集不能为空");
  }

  const items: CourseEvaluationItem[] = [];

  for (const evaluationCase of cases) {
    if (!evaluationCase.id.trim() || !evaluationCase.query.trim()) {
      throw new Error("评测项 id 和 query 不能为空");
    }

    const results = await search(evaluationCase.query, options.k);
    const topScore = results[0]?.score;
    const rejected = topScore === undefined || topScore < options.minScore;
    const acceptedResults = rejected ? [] : results;
    const retrievedSources = acceptedResults.map(
      (result) => result.document.metadata.source,
    );
    const expectedRejection = evaluationCase.expectedSources.length === 0;
    const firstRelevantIndex = retrievedSources.findIndex((source) =>
      evaluationCase.expectedSources.includes(source),
    );

    items.push({
      id: evaluationCase.id,
      query: evaluationCase.query,
      expectedSources: evaluationCase.expectedSources,
      retrievedSources,
      topScore,
      expectedRejection,
      rejected,
      hit: expectedRejection ? rejected : firstRelevantIndex >= 0,
      reciprocalRank:
        firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
    });
  }

  const positiveItems = items.filter((item) => !item.expectedRejection);
  const rejectionItems = items.filter((item) => item.expectedRejection);

  return {
    items,
    positiveCases: positiveItems.length,
    rejectionCases: rejectionItems.length,
    hitAtK:
      positiveItems.length === 0
        ? 1
        : positiveItems.filter((item) => item.hit).length /
          positiveItems.length,
    meanReciprocalRank:
      positiveItems.length === 0
        ? 1
        : positiveItems.reduce(
            (total, item) => total + item.reciprocalRank,
            0,
          ) / positiveItems.length,
    rejectionAccuracy:
      rejectionItems.length === 0
        ? 1
        : rejectionItems.filter((item) => item.rejected).length /
          rejectionItems.length,
  };
}
