import { loadEnvConfig } from "@next/env";
import path from "node:path";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { chunkDocuments } from "../lib/knowledge/chunker";
import { loadDocuments } from "../lib/knowledge/document-loader";
import {
  saveVectorIndex,
  VECTOR_INDEX_VERSION,
  type IndexedChunk,
} from "../lib/knowledge/vector-index";

function readArgument(name: string, fallback: string) {
  const args = process.argv.slice(2);
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(readArgument(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return value;
}

async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  const input = readArgument("--input", "data/l1-documents");
  const output = readArgument("--output", ".mini-maxkb/l1-index.json");
  const maxCharacters = readPositiveInteger("--chunk-size", 10);
  const overlapCharacters = readPositiveInteger("--overlap", 6);
  const config = readEmbeddingProviderConfig();
  const provider = createEmbeddingProvider(config);
  const documents = await loadDocuments(input);
  const chunks = chunkDocuments(documents, {
    maxCharacters,
    overlapCharacters,
  });

  if (chunks.length === 0) {
    throw new Error(`目录 ${path.resolve(input)} 中没有可索引的 .md 或 .txt 文档`);
  }

  console.log(
    `正在索引：${documents.length} 个文档，${chunks.length} 个分段，${provider.model} / ${provider.dimensions} 维`,
  );

  const indexedChunks: IndexedChunk[] = [];
  const batchSize = 50;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const response = await provider.embed({
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

  await saveVectorIndex(output, {
    version: VECTOR_INDEX_VERSION,
    createdAt: new Date().toISOString(),
    embedding: {
      provider: provider.id,
      model: provider.model,
      dimensions: provider.dimensions,
    },
    chunks: indexedChunks,
  });

  console.log(`索引完成：${path.resolve(output)}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`L1 索引失败：${message}`);
  process.exitCode = 1;
});
