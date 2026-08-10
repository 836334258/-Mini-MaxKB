import { searchChunksByKeyword } from "./keyword-search";
import { searchChunks } from "./semantic-search";
import type { IndexedChunk } from "./vector-index";

export interface HybridSearchOptions {
  topK: number;
  candidateK: number;
  minScore: number;
  semanticWeight: number;
}

export interface HybridSearchResult {
  score: number;
  semanticScore: number;
  keywordScore: number;
  chunk: IndexedChunk;
}

export interface RetrievalDiagnostics {
  strategy: "semantic" | "hybrid";
  candidateCount: number;
  returnedCount: number;
  minScore: number;
  semanticWeight: number;
  topScore?: number;
  rejected: boolean;
}

export interface HybridSearchResponse {
  results: HybridSearchResult[];
  diagnostics: RetrievalDiagnostics;
}

/** 校验混合检索参数，避免错误配置让所有资料被放行或全部被过滤。 */
export function validateHybridSearchOptions(options: HybridSearchOptions) {
  if (!Number.isInteger(options.topK) || options.topK <= 0) {
    throw new Error("RAG topK 必须是正整数");
  }
  if (!Number.isInteger(options.candidateK) || options.candidateK < options.topK) {
    throw new Error("RAG candidateK 必须是不小于 topK 的正整数");
  }
  if (options.minScore < 0 || options.minScore > 1) {
    throw new Error("RAG minScore 必须在 0 到 1 之间");
  }
  if (options.semanticWeight < 0 || options.semanticWeight > 1) {
    throw new Error("RAG semanticWeight 必须在 0 到 1 之间");
  }
}

/**
 * 融合语义相似度和归一化 BM25 分数，再应用最低相关度阈值。
 * 语义分数解决同义表达，关键词分数提升 API Key 等精确术语的排序。
 */
export function searchChunksHybrid(
  query: string,
  queryVector: number[],
  chunks: IndexedChunk[],
  options: HybridSearchOptions,
): HybridSearchResponse {
  validateHybridSearchOptions(options);

  const semanticResults = searchChunks(
    queryVector,
    chunks,
    Math.min(options.candidateK, Math.max(chunks.length, 1)),
  );
  const keywordResults = searchChunksByKeyword(
    query,
    chunks,
    options.candidateK,
  );
  const semanticScores = new Map(
    semanticResults.map((result) => [result.chunk.id, Math.max(0, result.score)]),
  );
  const keywordScores = new Map(
    keywordResults.map((result) => [result.chunk.id, result.score]),
  );
  const maximumKeywordScore = keywordResults[0]?.score ?? 0;
  const candidateIds = new Set([
    ...semanticResults.map((result) => result.chunk.id),
    ...keywordResults.map((result) => result.chunk.id),
  ]);
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const keywordWeight = 1 - options.semanticWeight;

  const candidates = [...candidateIds]
    .map((id) => {
      const chunk = chunksById.get(id);
      if (!chunk) {
        return undefined;
      }

      const semanticScore = semanticScores.get(id) ?? 0;
      const keywordScore = maximumKeywordScore > 0
        ? (keywordScores.get(id) ?? 0) / maximumKeywordScore
        : 0;
      return {
        chunk,
        semanticScore,
        keywordScore,
        score:
          options.semanticWeight * semanticScore +
          keywordWeight * keywordScore,
      };
    })
    .filter((result): result is HybridSearchResult => Boolean(result))
    .sort(
      (left, right) =>
        right.score - left.score || right.semanticScore - left.semanticScore,
    );
  const results = candidates
    .filter((result) => result.score >= options.minScore)
    .slice(0, options.topK);

  return {
    results,
    diagnostics: {
      strategy: "hybrid",
      candidateCount: candidates.length,
      returnedCount: results.length,
      minScore: options.minScore,
      semanticWeight: options.semanticWeight,
      topScore: candidates[0]?.score,
      rejected: results.length === 0,
    },
  };
}
