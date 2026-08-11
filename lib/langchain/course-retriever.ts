import type { Document } from "@langchain/core/documents";
import type { VectorStoreRetriever } from "@langchain/core/vectorstores";
import type { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

import type { CourseChunkMetadata } from "./document-processing";

export interface CourseRetrieverOptions {
  k?: number;
  source?: string;
}

/**
 * 把 VectorStore 包装成标准 Retriever。
 * Retriever 隐藏具体存储实现，只暴露“输入问题，返回 Documents”的接口。
 */
export function createCourseRetriever(
  vectorStore: MemoryVectorStore,
  options: CourseRetrieverOptions = {},
) {
  const k = options.k ?? 2;
  const source = options.source?.trim();

  if (!Number.isInteger(k) || k <= 0) {
    throw new Error("Retriever 的 k 必须是正整数");
  }

  return vectorStore.asRetriever({
    searchType: "similarity",
    k,
    ...(source
      ? {
          filter: (document) => document.metadata.source === source,
        }
      : {}),
  });
}

/**
 * 使用 Runnable 标准的 invoke() 执行一次检索，并收紧返回的 metadata 类型。
 */
export async function invokeCourseRetriever(
  retriever: VectorStoreRetriever<MemoryVectorStore>,
  query: string,
): Promise<Array<Document<CourseChunkMetadata>>> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Retriever 查询不能为空");
  }

  return (await retriever.invoke(normalizedQuery)) as Array<
    Document<CourseChunkMetadata>
  >;
}
