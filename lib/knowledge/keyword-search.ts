import type { IndexedChunk } from "./vector-index";

export interface KeywordSearchResult {
  score: number;
  chunk: IndexedChunk;
}

/**
 * 为中英文混合知识库生成检索词：英文保留单词，连续中文生成二元词组。
 * 二元词组不依赖额外分词服务，也能覆盖“向量模型”“重新索引”等短语。
 */
export function tokenizeForSearch(text: string) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [...(normalized.match(/[a-z0-9_]+/g) ?? [])];
  const chineseSegments = normalized.match(/[\p{Script=Han}]+/gu) ?? [];

  for (const segment of chineseSegments) {
    const characters = Array.from(segment);
    if (characters.length === 1) {
      tokens.push(characters[0]);
      continue;
    }

    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }

  return tokens;
}

/** 统计一个分段中各检索词出现的次数。 */
function countTerms(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * 使用 BM25 公式执行轻量关键词检索，适合当前本地 JSON 索引。
 * 数据规模扩大后可把同一接口替换为 Elasticsearch/OpenSearch。
 */
export function searchChunksByKeyword(
  query: string,
  chunks: IndexedChunk[],
  limit = 20,
): KeywordSearchResult[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("关键词检索 limit 必须是正整数");
  }

  const queryTerms = [...new Set(tokenizeForSearch(query))];
  if (queryTerms.length === 0 || chunks.length === 0) {
    return [];
  }

  const documents = chunks.map((chunk) => {
    const tokens = tokenizeForSearch(`${chunk.title}\n${chunk.content}`);
    return { chunk, length: tokens.length, terms: countTerms(tokens) };
  });
  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) /
    documents.length;
  const documentFrequency = new Map<string, number>();

  for (const term of queryTerms) {
    documentFrequency.set(
      term,
      documents.filter((document) => document.terms.has(term)).length,
    );
  }

  const k1 = 1.2;
  const b = 0.75;

  return documents
    .map((document) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = document.terms.get(term) ?? 0;
        if (frequency === 0) {
          continue;
        }

        const matchingDocuments = documentFrequency.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 +
            (documents.length - matchingDocuments + 0.5) /
              (matchingDocuments + 0.5),
        );
        const lengthRatio = averageLength > 0
          ? document.length / averageLength
          : 1;
        score +=
          inverseDocumentFrequency *
          ((frequency * (k1 + 1)) /
            (frequency + k1 * (1 - b + b * lengthRatio)));
      }

      return { score, chunk: document.chunk };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
