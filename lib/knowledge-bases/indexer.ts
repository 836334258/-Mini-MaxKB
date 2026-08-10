import { readFile } from "node:fs/promises";
import path from "node:path";

import type { EmbeddingProvider } from "../ai/embedding-types";
import type {
  KnowledgeBaseRepository,
  KnowledgeDocumentRecord,
} from "../db/knowledge-base-repository";
import { chunkDocument, type DocumentChunk } from "../knowledge/chunker";
import {
  saveVectorIndex,
  VECTOR_INDEX_VERSION,
  type IndexedChunk,
} from "../knowledge/vector-index";

const rebuilds = new Map<string, Promise<RebuildKnowledgeBaseResult>>();

export interface RebuildKnowledgeBaseResult {
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
}

/** 从 Markdown 一级标题提取标题，缺少标题时回退到上传文件名。 */
function getDocumentTitle(name: string, content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    path.basename(name, path.extname(name));
}

/** 读取一个上传文档，并生成 ID 唯一、来源名称可读的知识分段。 */
async function createDocumentChunks(
  documentsPath: string,
  document: KnowledgeDocumentRecord,
): Promise<DocumentChunk[]> {
  const content = (
    await readFile(path.join(documentsPath, document.storedName), "utf8")
  )
    .replace(/^\uFEFF/, "")
    .trim();

  if (!content) {
    throw new Error(`文档 ${document.name} 没有可索引内容`);
  }

  return chunkDocument(
    {
      source: document.id,
      title: getDocumentTitle(document.name, content),
      content,
    },
    { maxCharacters: 600, overlapCharacters: 80 },
  ).map((chunk) => ({ ...chunk, source: document.name }));
}

/** 执行一次完整重建，并将每个文档的状态和分段数同步回 SQLite。 */
async function rebuild(
  repository: KnowledgeBaseRepository,
  knowledgeBaseId: string,
  embeddingProvider: EmbeddingProvider,
): Promise<RebuildKnowledgeBaseResult> {
  const knowledgeBase = repository.getKnowledgeBaseRecord(knowledgeBaseId);
  if (!knowledgeBase) {
    throw new Error("知识库不存在");
  }
  if (knowledgeBase.isBuiltin) {
    throw new Error("默认示例知识库是只读的，不能重建");
  }

  const documents = repository.listDocumentRecords(knowledgeBaseId);
  if (documents.length === 0) {
    throw new Error("知识库中还没有可索引文档");
  }

  const chunksByDocument = new Map<string, DocumentChunk[]>();
  for (const document of documents) {
    repository.updateDocumentStatus(document.id, "indexing", 0);
    try {
      const chunks = await createDocumentChunks(
        knowledgeBase.documentsPath,
        document,
      );
      chunksByDocument.set(document.id, chunks);
    } catch (error) {
      repository.updateDocumentStatus(
        document.id,
        "error",
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const chunks = [...chunksByDocument.values()].flat();
  if (chunks.length === 0) {
    repository.updateChunkCount(knowledgeBaseId, 0);
    throw new Error("知识库中没有成功生成的知识分段");
  }

  const indexedChunks: IndexedChunk[] = [];
  try {
    for (let start = 0; start < chunks.length; start += 50) {
      const batch = chunks.slice(start, start + 50);
      const response = await embeddingProvider.embed({
        purpose: "document",
        inputs: batch.map((chunk) => ({
          text: chunk.content,
          title: chunk.title,
        })),
      });
      indexedChunks.push(
        ...batch.map((chunk, index) => ({
          ...chunk,
          vector: response.vectors[index],
        })),
      );
    }

    await saveVectorIndex(knowledgeBase.indexPath, {
      version: VECTOR_INDEX_VERSION,
      createdAt: new Date().toISOString(),
      embedding: {
        provider: embeddingProvider.id,
        model: embeddingProvider.model,
        dimensions: embeddingProvider.dimensions,
      },
      chunks: indexedChunks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const documentId of chunksByDocument.keys()) {
      repository.updateDocumentStatus(documentId, "error", 0, message);
    }
    throw error;
  }

  for (const [documentId, documentChunks] of chunksByDocument) {
    repository.updateDocumentStatus(
      documentId,
      "ready",
      documentChunks.length,
    );
  }
  repository.updateChunkCount(knowledgeBaseId, indexedChunks.length);

  return {
    documentCount: documents.length,
    indexedDocumentCount: chunksByDocument.size,
    chunkCount: indexedChunks.length,
  };
}

/** 同一知识库串行重建，避免并发上传互相覆盖索引文件。 */
export function rebuildKnowledgeBaseIndex(
  repository: KnowledgeBaseRepository,
  knowledgeBaseId: string,
  embeddingProvider: EmbeddingProvider,
) {
  const previous = rebuilds.get(knowledgeBaseId);
  const current = (previous?.catch(() => undefined) ?? Promise.resolve()).then(
    () => rebuild(repository, knowledgeBaseId, embeddingProvider),
  );
  rebuilds.set(knowledgeBaseId, current);
  const clearCurrent = () => {
    if (rebuilds.get(knowledgeBaseId) === current) {
      rebuilds.delete(knowledgeBaseId);
    }
  };
  void current.then(clearCurrent, clearCurrent);
  return current;
}
