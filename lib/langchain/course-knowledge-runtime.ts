import { stat } from "node:fs/promises";

import { readEmbeddingProviderConfig } from "../ai/embedding-config";
import { createEmbeddingProvider } from "../ai/embedding-registry";
import { loadAndSplitTextDocument } from "./document-processing";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
} from "./semantic-search";

const COURSE_DOCUMENT_PATHS = [
  "data/l1-documents/learning-path.md",
  "data/l1-documents/model-management.md",
  "data/l1-documents/security.md",
];

export interface CourseKnowledgeRuntime {
  vectorStore: Awaited<ReturnType<typeof buildCourseVectorStore>>;
  sourceCount: number;
  chunkCount: number;
  embeddingProvider: string;
  embeddingModel: string;
}

const globalCourseRuntime = globalThis as typeof globalThis & {
  langchainCourseRuntime?: {
    key: string;
    promise: Promise<CourseKnowledgeRuntime>;
  };
};

/** 根据 Embedding 配置和文件状态生成不含 API Key 的缓存键。 */
async function createRuntimeCacheKey() {
  const config = readEmbeddingProviderConfig();
  const fileStates = await Promise.all(
    COURSE_DOCUMENT_PATHS.map(async (filePath) => {
      const fileStat = await stat(filePath);
      return `${filePath}:${fileStat.size}:${fileStat.mtimeMs}`;
    }),
  );

  return [
    config.provider,
    config.model,
    config.dimensions,
    ...fileStates,
  ].join("|");
}

/** 加载课程文档并建立一次内存向量库。 */
async function buildCourseKnowledgeRuntime(): Promise<CourseKnowledgeRuntime> {
  const loadedDocuments = await Promise.all(
    COURSE_DOCUMENT_PATHS.map((filePath) =>
      loadAndSplitTextDocument(filePath, {
        chunkSize: 120,
        chunkOverlap: 20,
      }),
    ),
  );
  const chunks = loadedDocuments.flatMap((result) => result.chunks);
  const provider = createEmbeddingProvider(readEmbeddingProviderConfig());
  const vectorStore = await buildCourseVectorStore(
    chunks,
    new LangChainEmbeddingsAdapter(provider),
  );

  return {
    vectorStore,
    sourceCount: COURSE_DOCUMENT_PATHS.length,
    chunkCount: chunks.length,
    embeddingProvider: provider.id,
    embeddingModel: provider.model,
  };
}

/**
 * 复用当前进程中的向量库；配置或源文件变化时创建新的缓存 Promise。
 * 失败的 Promise 会被移除，下一次请求可以重新尝试。
 */
export async function getCourseKnowledgeRuntime() {
  const key = await createRuntimeCacheKey();

  if (globalCourseRuntime.langchainCourseRuntime?.key === key) {
    return globalCourseRuntime.langchainCourseRuntime.promise;
  }

  const promise = buildCourseKnowledgeRuntime();
  globalCourseRuntime.langchainCourseRuntime = { key, promise };

  try {
    return await promise;
  } catch (error) {
    if (globalCourseRuntime.langchainCourseRuntime?.promise === promise) {
      globalCourseRuntime.langchainCourseRuntime = undefined;
    }
    throw error;
  }
}
