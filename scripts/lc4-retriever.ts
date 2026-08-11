import { loadEnvConfig } from "@next/env";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  createCourseRetriever,
  invokeCourseRetriever,
} from "../lib/langchain/course-retriever";
import { loadAndSplitTextDocument } from "../lib/langchain/document-processing";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
} from "../lib/langchain/semantic-search";

const DEFAULT_INPUTS = [
  "data/l1-documents/learning-path.md",
  "data/l1-documents/model-management.md",
  "data/l1-documents/security.md",
];
const DEFAULT_QUERY = "API Key 应该保存在哪里？";

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

/** 把逗号分隔的文件列表转换成非空路径数组。 */
function readInputPaths() {
  const paths = readArgument("--inputs", DEFAULT_INPUTS.join(","))
    .split(",")
    .map((input) => input.trim())
    .filter(Boolean);

  if (paths.length === 0) {
    throw new Error("--inputs 至少需要一个文档路径");
  }

  return paths;
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
 * 运行 LC4：为多个来源建立向量库，再通过 Retriever.invoke() 获取 Documents。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const inputPaths = readInputPaths();
  const query = readArgument("--query", DEFAULT_QUERY);
  const k = readPositiveInteger("--top-k", 2);
  const source = readArgument("--source", "").trim() || undefined;
  const loadedDocuments = await Promise.all(
    inputPaths.map((inputPath) =>
      loadAndSplitTextDocument(inputPath, {
        chunkSize: 120,
        chunkOverlap: 20,
      }),
    ),
  );
  const chunks = loadedDocuments.flatMap((result) => result.chunks);
  const embeddingConfig = readEmbeddingProviderConfig();
  const provider = createEmbeddingProvider(embeddingConfig);
  const embeddings = new LangChainEmbeddingsAdapter(provider);

  console.log(
    `LC4 正在索引 ${inputPaths.length} 个来源、${chunks.length} 个 chunks：${provider.id} / ${provider.model}`,
  );
  const vectorStore = await buildCourseVectorStore(chunks, embeddings);
  const retriever = createCourseRetriever(vectorStore, { k, source });

  console.log(`\n用户问题：${query}`);
  console.log(`Retriever 配置：k=${k}，source=${source ?? "不限"}`);
  const documents = await invokeCourseRetriever(retriever, query);

  console.log(`返回 ${documents.length} 个 Document。`);
  console.log("Retriever 默认隐藏相似度分数，只提供后续 Chain 需要的文档。\n");

  for (const [rank, document] of documents.entries()) {
    console.log(`--- 第 ${rank + 1} 个 Document｜${document.id} ---`);
    console.log(document.pageContent);
    console.log("metadata：");
    console.dir(document.metadata, { depth: null, colors: true });
    console.log();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC4 运行失败：${message}`);
  process.exitCode = 1;
});
