import { loadEnvConfig } from "@next/env";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { createCourseRetriever } from "../lib/langchain/course-retriever";
import { loadAndSplitTextDocument } from "../lib/langchain/document-processing";
import {
  configureCourseModelAuthentication,
  createCourseChatModel,
  readCourseModelConfig,
} from "../lib/langchain/model-config";
import { createCourseRagChain } from "../lib/langchain/rag-chain";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
} from "../lib/langchain/semantic-search";

const DEFAULT_INPUTS = [
  "data/l1-documents/learning-path.md",
  "data/l1-documents/model-management.md",
  "data/l1-documents/security.md",
];
const DEFAULT_QUESTION = "更换 Embedding 模型后需要做什么？";

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

/** 把逗号分隔的文档参数转换成路径数组。 */
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

/** 读取聊天模型覆盖参数；Embedding 模型仍使用独立环境变量配置。 */
function readModelEnvironment() {
  const provider = readArgument("--provider", "").trim();
  const model = readArgument("--model", "").trim();

  return {
    ...process.env,
    ...(provider ? { LANGCHAIN_MODEL_PROVIDER: provider } : {}),
    ...(model ? { LANGCHAIN_MODEL: model } : {}),
  };
}

/**
 * 运行 LC5：建立临时知识索引，通过 Retriever 获取资料，再让聊天模型生成回答。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const inputPaths = readInputPaths();
  const question = readArgument("--question", DEFAULT_QUESTION);
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
  const embeddingProvider = createEmbeddingProvider(embeddingConfig);
  const embeddings = new LangChainEmbeddingsAdapter(embeddingProvider);
  const vectorStore = await buildCourseVectorStore(chunks, embeddings);
  const retriever = createCourseRetriever(vectorStore, { k: 2, source });

  const modelConfig = readCourseModelConfig(readModelEnvironment());
  configureCourseModelAuthentication(modelConfig);
  const chatModel = await createCourseChatModel(modelConfig);
  const ragChain = createCourseRagChain(retriever, chatModel);

  console.log(
    `LC5 RAG：${inputPaths.length} 个来源，${chunks.length} 个 chunks`,
  );
  console.log(
    `Embedding：${embeddingProvider.id} / ${embeddingProvider.model}`,
  );
  console.log(`Chat：${modelConfig.modelProvider} / ${modelConfig.model}`);
  console.log(`问题：${question}\n`);

  const result = await ragChain.invoke({ question });

  console.log("检索来源：");
  if (result.sources.length === 0) {
    console.log("（没有检索结果）");
  } else {
    for (const [index, document] of result.sources.entries()) {
      console.log(
        `[资料 ${index + 1}] ${document.metadata.source}#chunk-${document.metadata.chunkIndex}`,
      );
    }
  }

  console.log(`\n最终回答：\n${result.answer}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC5 运行失败：${message}`);
  process.exitCode = 1;
});
