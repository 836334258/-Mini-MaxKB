import {
  searchChunksHybrid,
  type HybridSearchOptions,
} from "../knowledge/hybrid-search";
import type { IndexedChunk } from "../knowledge/vector-index";

export interface RetrievalEvaluationCase {
  id: string;
  query: string;
  expectedSources: string[];
}

export interface RetrievalEvaluationItem {
  id: string;
  query: string;
  retrievedSources: string[];
  hit: boolean;
  reciprocalRank: number;
  expectedRejection: boolean;
  rejected: boolean;
  topScore?: number;
}

export interface RetrievalEvaluationReport {
  items: RetrievalEvaluationItem[];
  positiveCases: number;
  hitAtK: number;
  meanReciprocalRank: number;
  rejectionAccuracy: number;
}

/**
 * 对标注问题执行混合检索，计算 Hit@K、MRR 和越界问题拒答准确率。
 */
export function evaluateRetrieval(
  cases: RetrievalEvaluationCase[],
  queryVectors: number[][],
  chunks: IndexedChunk[],
  options: HybridSearchOptions,
): RetrievalEvaluationReport {
  if (cases.length !== queryVectors.length) {
    throw new Error("评测问题数量与查询向量数量不一致");
  }

  const items = cases.map((evaluationCase, index) => {
    const response = searchChunksHybrid(
      evaluationCase.query,
      queryVectors[index],
      chunks,
      options,
    );
    const retrievedSources = response.results.map(
      (result) => result.chunk.source,
    );
    const expectedRejection = evaluationCase.expectedSources.length === 0;
    const firstRelevantIndex = retrievedSources.findIndex((source) =>
      evaluationCase.expectedSources.includes(source),
    );

    return {
      id: evaluationCase.id,
      query: evaluationCase.query,
      retrievedSources,
      hit: expectedRejection ? response.diagnostics.rejected : firstRelevantIndex >= 0,
      reciprocalRank: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
      expectedRejection,
      rejected: response.diagnostics.rejected,
      topScore: response.diagnostics.topScore,
    };
  });
  const positiveItems = items.filter((item) => !item.expectedRejection);
  const rejectionItems = items.filter((item) => item.expectedRejection);

  return {
    items,
    positiveCases: positiveItems.length,
    hitAtK:
      positiveItems.length > 0
        ? positiveItems.filter((item) => item.hit).length / positiveItems.length
        : 1,
    meanReciprocalRank:
      positiveItems.length > 0
        ? positiveItems.reduce((total, item) => total + item.reciprocalRank, 0) /
          positiveItems.length
        : 1,
    rejectionAccuracy:
      rejectionItems.length > 0
        ? rejectionItems.filter((item) => item.rejected).length /
          rejectionItems.length
        : 1,
  };
}
