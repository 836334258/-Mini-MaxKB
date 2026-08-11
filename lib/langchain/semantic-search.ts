import type { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

import type {
  EmbeddingProvider,
  EmbeddingRequest,
} from "../ai/embedding-types";
import type { CourseChunkMetadata } from "./document-processing";

/** 带余弦相似度分数的课程检索结果。分数越大，语义越接近。 */
export interface CourseSearchResult {
  document: Document<CourseChunkMetadata>;
  score: number;
}

/**
 * 把 Mini-MaxKB 已有的可替换 Embedding Provider，适配成 LangChain 接口。
 * VectorStore 因此只依赖 embedDocuments/embedQuery，不需要知道 Google API。
 */
export class LangChainEmbeddingsAdapter implements EmbeddingsInterface {
  constructor(private readonly provider: EmbeddingProvider) {}

  /** 为多个知识片段批量生成“文档向量”，用于建立索引。 */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return this.embed({
      purpose: "document",
      inputs: documents.map((text) => ({ text })),
    });
  }

  /** 为用户问题生成“查询向量”，用于和文档向量比较。 */
  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embed({
      purpose: "query",
      inputs: [{ text: query }],
    });

    return vector;
  }

  /** 调用底层 Provider，并统一检查向量数量是否完整。 */
  private async embed(request: EmbeddingRequest) {
    const response = await this.provider.embed(request);

    if (response.vectors.length !== request.inputs.length) {
      throw new Error(
        `Embedding 向量数量不匹配：期望 ${request.inputs.length}，实际 ${response.vectors.length}`,
      );
    }

    return response.vectors;
  }
}

/**
 * 给所有小 Document 生成向量，并存入临时内存向量库。
 * MemoryVectorStore 适合教学；Node 进程退出后，索引也会消失。
 */
export async function buildCourseVectorStore(
  chunks: Array<Document<CourseChunkMetadata>>,
  embeddings: EmbeddingsInterface,
) {
  if (chunks.length === 0) {
    throw new Error("至少需要一个 Document chunk 才能建立向量索引");
  }

  return MemoryVectorStore.fromDocuments(chunks, embeddings);
}

/**
 * 把问题向量化并返回最相似的前 k 个小 Document。
 * 本函数只负责检索，不调用聊天模型生成答案。
 */
export async function searchCourseVectorStore(
  vectorStore: MemoryVectorStore,
  query: string,
  k = 2,
): Promise<CourseSearchResult[]> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("检索问题不能为空");
  }

  if (!Number.isInteger(k) || k <= 0) {
    throw new Error("k 必须是正整数");
  }

  const results = await vectorStore.similaritySearchWithScore(
    normalizedQuery,
    k,
  );

  return results.map(([document, score]) => ({
    document: document as Document<CourseChunkMetadata>,
    score,
  }));
}
