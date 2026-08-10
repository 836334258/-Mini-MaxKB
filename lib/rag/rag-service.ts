import type { EmbeddingProvider } from "../ai/embedding-types";
import type {
  ChatMessage,
  ChatProvider,
  ChatResponse,
} from "../ai/types";
import {
  searchChunksHybrid,
  type HybridSearchOptions,
  type RetrievalDiagnostics,
} from "../knowledge/hybrid-search";
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
  retrieval?: HybridSearchOptions;
}

export interface RagSearchResult extends SearchResult {
  semanticScore?: number;
  keywordScore?: number;
}

export interface RagAnswer {
  response: ChatResponse;
  sources: RagSearchResult[];
  diagnostics: RetrievalDiagnostics;
  grounded: boolean;
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

  let sources: RagSearchResult[];
  let diagnostics: RetrievalDiagnostics;

  if (options.retrieval) {
    const retrieval = searchChunksHybrid(
      question,
      queryVector,
      dependencies.index.chunks,
      options.retrieval,
    );
    sources = retrieval.results;
    diagnostics = retrieval.diagnostics;
  } else {
    sources = searchChunks(
      queryVector,
      dependencies.index.chunks,
      options.topK ?? 3,
    ).map((result) => ({ ...result, semanticScore: result.score }));
    diagnostics = {
      strategy: "semantic",
      candidateCount: dependencies.index.chunks.length,
      returnedCount: sources.length,
      minScore: 0,
      semanticWeight: 1,
      topScore: sources[0]?.score,
      rejected: sources.length === 0,
    };
  }

  if (sources.length === 0) {
    return {
      response: {
        provider: dependencies.chatProvider.id,
        model: dependencies.chatProvider.model,
        content:
          "知识库中没有检索到足够相关的资料，我暂时无法可靠回答这个问题。请补充资料或换一种问法。",
      },
      sources,
      diagnostics,
      grounded: false,
    };
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

  return { response, sources, diagnostics, grounded: true };
}
