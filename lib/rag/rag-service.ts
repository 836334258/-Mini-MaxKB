import type { EmbeddingProvider } from "../ai/embedding-types";
import type {
  ChatMessage,
  ChatProvider,
  ChatResponse,
} from "../ai/types";
import { searchChunks, type SearchResult } from "../knowledge/semantic-search";
import type { VectorIndex } from "../knowledge/vector-index";

interface RagDependencies {
  chatProvider: ChatProvider;
  embeddingProvider: EmbeddingProvider;
  index: VectorIndex;
}

interface AskKnowledgeBaseOptions {
  question: string;
  topK?: number;
  systemPrompt?: string;
  history?: ChatMessage[];
}

export interface RagAnswer {
  response: ChatResponse;
  sources: SearchResult[];
}

/**
 * 将检索结果转换成带编号的知识上下文。
 * 编号同时用于模型回答中的引用标记和命令行末尾的来源列表。
 */
export function formatKnowledgeContext(results: SearchResult[]) {
  return results
    .map(
      (result, index) =>
        `[${index + 1}]\n标题：${result.chunk.title}\n来源：${result.chunk.source}#${result.chunk.position}\n内容：${result.chunk.content}`,
    )
    .join("\n\n");
}

/**
 * 生成统一的 RAG 消息，约束模型仅根据检索资料作答并标注来源编号。
 */
export function buildRagMessages(
  question: string,
  results: SearchResult[],
  customSystemPrompt?: string,
  history: ChatMessage[] = [],
): ChatMessage[] {
  const ragInstruction = [
    customSystemPrompt?.trim(),
    "你是知识库问答助手。只能根据提供的知识库资料回答；回答中的事实请使用 [1]、[2] 这样的编号标注来源。如果资料不足，请明确说明资料不足，不要编造。",
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log("*********************ragInstruction:", [
    { role: "system", content: ragInstruction },
    {
      role: "user",
      content: `知识库资料：\n\n${formatKnowledgeContext(results)}\n\n问题：${question}`,
    },
  ]);
  return [
    { role: "system", content: ragInstruction },
    ...history.filter((message) => message.role !== "system"),
    {
      role: "user",
      content: `知识库资料：\n\n${formatKnowledgeContext(results)}\n\n问题：${question}`,
    },
  ];
}

/**
 * 执行一次完整 RAG：向量化问题、召回知识片段，再交给聊天模型生成答案。
 */
export async function askKnowledgeBase(
  dependencies: RagDependencies,
  options: AskKnowledgeBaseOptions,
): Promise<RagAnswer> {
  const question = options.question.trim();
  if (!question) {
    throw new Error("问题不能为空");
  }

  const embedding = await dependencies.embeddingProvider.embed({
    purpose: "query",
    inputs: [{ text: question }],
  });
  const queryVector = embedding.vectors[0];
  if (!queryVector) {
    throw new Error("Embedding 模型没有返回问题向量");
  }

  const sources = searchChunks(
    queryVector,
    dependencies.index.chunks,
    options.topK ?? 3,
  );
  if (sources.length === 0) {
    throw new Error("知识库索引中没有可用的文档分段");
  }

  const response = await dependencies.chatProvider.chat({
    messages: buildRagMessages(
      question,
      sources,
      options.systemPrompt,
      options.history,
    ),
    temperature: 0.2,
  });

  return { response, sources };
}
