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
  loadPersistentCourseConversation,
  savePersistentCourseTurn,
  toCourseModelProvider,
  toStoredChatProvider,
} from "../lib/langchain/persistent-conversation";
import {
  buildCourseVectorStore,
  LangChainEmbeddingsAdapter,
} from "../lib/langchain/semantic-search";
import { ConversationRepository } from "../lib/db/conversation-repository";

const INPUTS = [
  "data/l1-documents/learning-path.md",
  "data/l1-documents/model-management.md",
  "data/l1-documents/security.md",
];
const DEFAULT_DATABASE_PATH = ".mini-maxkb/lc7-course.sqlite";
const DEFAULT_NEW_QUESTION = "更换 Embedding 模型后需要做什么？";
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

/** 根据新会话参数或已有会话固定配置，生成本次 ChatModel 环境。 */
function readConversationModelEnvironment(
  storedProvider?: "gemini" | "deepseek",
  storedModel?: string,
) {
  const provider = storedProvider
    ? toCourseModelProvider(storedProvider)
    : readArgument("--provider", "").trim();
  const model = storedModel ?? readArgument("--model", "").trim();

  return {
    ...process.env,
    ...(provider ? { LANGCHAIN_MODEL_PROVIDER: provider } : {}),
    ...(model ? { LANGCHAIN_MODEL: model } : {}),
  };
}

/**
 * 运行 LC7：按 conversationId 恢复 SQLite 历史，执行一轮 RAG，成功后保存消息。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const databasePath = readArgument(
    "--database",
    process.env.LANGCHAIN_COURSE_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
  );
  const requestedConversationId = readArgument("--conversation-id", "").trim();
  const repository = new ConversationRepository(databasePath);

  try {
    const storedSession = requestedConversationId
      ? loadPersistentCourseConversation(repository, requestedConversationId)
      : undefined;
    const question = readArgument(
      "--question",
      storedSession ? DEFAULT_FOLLOW_UP : DEFAULT_NEW_QUESTION,
    );
    const history: CourseConversationTurn[] = storedSession?.history ?? [];
    const modelConfig = readCourseModelConfig(
      readConversationModelEnvironment(
        storedSession?.conversation.provider,
        storedSession?.conversation.model,
      ),
    );
    configureCourseModelAuthentication(modelConfig);

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
    const chatModel = await createCourseChatModel(modelConfig);
    const ragChain = createConversationalRagChain(retriever, {
      answerModel: chatModel,
    });

    console.log(`LC7 SQLite：${databasePath}`);
    console.log(`已恢复历史：${history.length} 轮`);
    console.log(`Chat：${modelConfig.modelProvider}/${modelConfig.model}`);
    console.log(`用户：${question}\n`);

    const result = await ragChain.invoke({ question, history });
    const conversation =
      storedSession?.conversation ??
      repository.createConversation({
        title: question,
        provider: toStoredChatProvider(modelConfig.modelProvider),
        model: modelConfig.model,
        knowledgeBaseId: "langchain-course",
      });
    savePersistentCourseTurn(repository, conversation.id, {
      question,
      answer: result.answer,
    });

    console.log(`独立检索问题：${result.standaloneQuestion}`);
    console.log(`回答：${result.answer}`);
    console.log(`\nconversationId：${conversation.id}`);
    console.log(
      `数据库消息数：${repository.getConversation(conversation.id)?.messages.length ?? 0}`,
    );
    console.log("再次运行时传入这个 conversationId，即可在新进程中继续对话。");
  } finally {
    repository.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);、
  console.error(`LC7 运行失败：${message}`);
  process.exitCode = 1;
});
