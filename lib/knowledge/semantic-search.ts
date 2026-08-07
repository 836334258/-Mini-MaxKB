import type { IndexedChunk } from "./vector-index";

export interface SearchResult {
  score: number;
  chunk: IndexedChunk;
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error("余弦相似度要求两个非空且维度相同的向量");
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function searchChunks(
  queryVector: number[],
  chunks: IndexedChunk[],
  topK = 3,
): SearchResult[] {
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error("topK 必须是正整数");
  }

  return chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryVector, chunk.vector),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
