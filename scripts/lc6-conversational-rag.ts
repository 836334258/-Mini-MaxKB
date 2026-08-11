import { loadEnvConfig } from "@next/env";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  createConversationalRagChain,
  type CourseConversationTurn,
} from "../lib/langchain/conversational-rag";
import { createCourseRetriever } from "../lib/langchain/course-retriever";
import { loadAndSplitTextDocument } from "../lib/langchain/document-processing";
import {
  configureCourseModelAuthentication,
  createCourseChatModel,
  readCourseModelConfig,
} from "../lib/langchain/model-config";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
} from "../lib/langchain/semantic-search";

const INPUTS = [
  "data/l1-documents/learning-path.md",
  "data/l1-documents/model-management.md",
  "data/l1-documents/security.md",
];
const DEFAULT_FIRST_QUESTION = "更换 Embedding 模型后需要做什么？";
const DEFAULT_FOLLOW_UP = "为什么必须这样做？";

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

/** 读取可选的聊天模型覆盖配置，Embedding 模型仍独立配置。 */
function readModelEnvironment() {
  const provider = readArgument("--provider", "").trim();
  const model = readArgument("--model", "").trim();

  return {
    ...process.env,
    ...(provider ? { LANGCHAIN_MODEL_PROVIDER: provider } : {}),
    ...(model ? { LANGCHAIN_MODEL: model } : {}),
  };
}

/** 打印一轮 RAG 的改写问题、来源和最终回答。 */
function printTurn(
  turnNumber: number,
  question: string,
  result: Awaited<ReturnType<ReturnType<typeof createConversationalRagChain>["invoke"]>>,
) {
  console.log(`\n========== 第 ${turnNumber} 轮 ==========`);
  console.log(`用户：${question}`);
  console.log(`独立检索问题：${result.standaloneQuestion}`);
  console.log("检索来源：");

  for (const [index, document] of result.sources.entries()) {
    console.log(
      `[资料 ${index + 1}] ${document.metadata.source}#chunk-${document.metadata.chunkIndex}`,
    );
  }

  console.log(`回答：${result.answer}`);
}

/**
 * 运行 LC6：第一轮正常 RAG，第二轮携带第一轮历史并改写模糊追问。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const firstQuestion = readArgument("--question", DEFAULT_FIRST_QUESTION);
  const followUp = readArgument("--follow-up", DEFAULT_FOLLOW_UP);
  const loadedDocuments = await Promise.all(
    INPUTS.map((inputPath) =>
      loadAndSplitTextDocument(inputPath, {
        chunkSize: 120,
        chunkOverlap: 20,
      }),
    ),
  );
  const chunks = loadedDocuments.flatMap((result) => result.chunks);
  const embeddingProvider = createEmbeddingProvider(
    readEmbeddingProviderConfig(),
  );
  const vectorStore = await buildCourseVectorStore(
    chunks,
    new LangChainEmbeddingsAdapter(embeddingProvider),
  );
  const retriever = createCourseRetriever(vectorStore, { k: 2 });

  const modelConfig = readCourseModelConfig(readModelEnvironment());
  configureCourseModelAuthentication(modelConfig);
  const chatModel = await createCourseChatModel(modelConfig);
  const ragChain = createConversationalRagChain(retriever, {
    answerModel: chatModel,
  });

  console.log(
    `LC6 对话式 RAG：Embedding=${embeddingProvider.model}，Chat=${modelConfig.modelProvider}/${modelConfig.model}`,
  );

  const history: CourseConversationTurn[] = [];
  const firstResult = await ragChain.invoke({
    question: firstQuestion,
    history,
  });
  printTurn(1, firstQuestion, firstResult);
  history.push({ question: firstQuestion, answer: firstResult.answer });

  const followUpResult = await ragChain.invoke({
    question: followUp,
    history,
  });
  printTurn(2, followUp, followUpResult);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC6 运行失败：${message}`);
  process.exitCode = 1;
});
