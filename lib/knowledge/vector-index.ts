import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EmbeddingProviderConfig } from "../ai/embedding-types";
import type { DocumentChunk } from "./chunker";

export const VECTOR_INDEX_VERSION = 1;

export interface IndexedChunk extends DocumentChunk {
  vector: number[];
}

export interface VectorIndex {
  version: number;
  createdAt: string;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
  };
  chunks: IndexedChunk[];
}

export async function saveVectorIndex(filePath: string, index: VectorIndex) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(index)}\n`, "utf8");
}

export async function loadVectorIndex(filePath: string) {
  const raw = await readFile(path.resolve(filePath), "utf8");
  const index = JSON.parse(raw) as VectorIndex;

  if (index.version !== VECTOR_INDEX_VERSION || !Array.isArray(index.chunks)) {
    throw new Error("索引格式不受支持，请重新执行 L1 索引");
  }

  return index;
}

export function assertIndexCompatible(
  index: VectorIndex,
  config: EmbeddingProviderConfig,
) {
  const matches =
    index.embedding.provider === config.provider &&
    index.embedding.model === config.model.replace(/^models\//, "") &&
    index.embedding.dimensions === config.dimensions;

  if (!matches) {
    throw new Error(
      "当前向量模型与索引不一致。默认示例库请重新执行 pnpm l1:index，自定义知识库请在管理页重建索引。",
    );
  }
}
