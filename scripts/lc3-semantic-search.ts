import { loadEnvConfig } from "@next/env";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { loadAndSplitTextDocument } from "../lib/langchain/document-processing";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
  searchCourseVectorStore,
} from "../lib/langchain/semantic-search";

const DEFAULT_INPUT = "data/l1-documents/learning-path.md";
const DEFAULT_QUERY = "哪一个阶段会学习语义搜索？";

/** 读取 `--name value` 或 `--name=value` 两种命令行参数格式。 */
function readArgument(name: string, fallback: string) {
  const argumentsList = process.argv.slice(2);
  const inlineArgument = argumentsList.find((argument) =>
    argument.startsWith(`${name}=`),
  );

  if (inlineArgument) {
    return inlineArgument.slice(name.length + 1);
  }

  const argumentIndex = argumentsList.indexOf(name);
  return argumentIndex >= 0
    ? (argumentsList[argumentIndex + 1] ?? fallback)
    : fallback;
}

/** 读取正整数命令行参数。 */
function readPositiveInteger(name: string, fallback: number) {
  const value = Number(readArgument(name, String(fallback)));

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }

  return value;
}

/**
 * 运行 LC3：切分文档、建立临时向量索引，再打印带分数的语义检索结果。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const input = readArgument("--input", DEFAULT_INPUT);
  const query = readArgument("--query", DEFAULT_QUERY);
  const topK = readPositiveInteger("--top-k", 2);
  const embeddingConfig = readEmbeddingProviderConfig();
  const provider = createEmbeddingProvider(embeddingConfig);
  const embeddings = new LangChainEmbeddingsAdapter(provider);
  const { chunks } = await loadAndSplitTextDocument(input, {
    chunkSize: 80,
    chunkOverlap: 15,
  });

  console.log(
    `LC3 正在为 ${chunks.length} 个 chunks 生成文档向量：${provider.id} / ${provider.model}`,
  );
  const vectorStore = await buildCourseVectorStore(chunks, embeddings);
  const firstVector = vectorStore.memoryVectors[0]?.embedding;

  console.log(`索引中的向量数量：${vectorStore.memoryVectors.length}`);
  console.log(`每个向量的维度：${firstVector?.length ?? 0}`);
  console.log(
    `第一个向量的前 8 个数字：${firstVector?.slice(0, 8).map((value) => value.toFixed(6)).join(", ")}`,
  );
  console.log(`\n用户问题：${query}`);

  const results = await searchCourseVectorStore(vectorStore, query, topK);

  for (const [rank, result] of results.entries()) {
    console.log(
      `\n--- 第 ${rank + 1} 名｜相似度 ${result.score.toFixed(6)}｜${result.document.id} ---`,
    );
    console.log(result.document.pageContent);
    console.log("metadata：");
    console.dir(result.document.metadata, { depth: null, colors: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC3 运行失败：${message}`);
  process.exitCode = 1;
});
