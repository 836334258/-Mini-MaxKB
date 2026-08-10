import type { HybridSearchOptions } from "../knowledge/hybrid-search";

/** 读取有范围限制的数字环境变量，并给出明确配置错误。 */
function readNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须在 ${minimum} 到 ${maximum} 之间`);
  }
  return value;
}

/** 读取 L4 混合检索配置；参数只在服务端使用。 */
export function readRetrievalConfig(): HybridSearchOptions {
  const topK = readNumber("RAG_TOP_K", 3, 1, 20);
  const candidateK = readNumber("RAG_CANDIDATE_K", 12, 1, 100);

  if (!Number.isInteger(topK) || !Number.isInteger(candidateK)) {
    throw new Error("RAG_TOP_K 和 RAG_CANDIDATE_K 必须是整数");
  }

  return {
    topK,
    candidateK: Math.max(candidateK, topK),
    minScore: readNumber("RAG_MIN_SCORE", 0.45, 0, 1),
    semanticWeight: readNumber("RAG_SEMANTIC_WEIGHT", 0.7, 0, 1),
  };
}
