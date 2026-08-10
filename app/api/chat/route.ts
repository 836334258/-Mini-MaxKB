import { readChatProviderConfig } from "../../../lib/ai/config";
import { readEmbeddingProviderConfig } from "../../../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../../../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../../../lib/ai/network";
import { createChatProvider } from "../../../lib/ai/provider-registry";
import type { ChatProviderId } from "../../../lib/ai/types";
import {
  encodeChatStreamEvent,
  type ChatStreamEvent,
} from "../../../lib/chat-stream/types";
import type { MessageSource } from "../../../lib/conversations/types";
import { getConversationRepository } from "../../../lib/db/conversation-repository";
import {
  assertIndexCompatible,
  loadVectorIndex,
} from "../../../lib/knowledge/vector-index";
import { askKnowledgeBase } from "../../../lib/rag/rag-service";
import { readRetrievalConfig } from "../../../lib/rag/retrieval-config";

export const runtime = "nodejs";

interface ChatBody {
  conversationId?: string;
  message?: string;
  provider?: ChatProviderId;
  model?: string;
}

const encoder = new TextEncoder();

/** 将 RAG 检索结果转换成适合持久化和页面展示的来源快照。 */
function toMessageSources(
  sources: Awaited<ReturnType<typeof askKnowledgeBase>>["sources"],
): MessageSource[] {
  return sources.map(({ chunk, score, semanticScore, keywordScore }) => ({
    id: chunk.id,
    source: chunk.source,
    title: chunk.title,
    position: chunk.position,
    score,
    semanticScore,
    keywordScore,
    content: chunk.content,
  }));
}

/** 将完整答案按 Unicode 字符切成小段，交给 NDJSON 响应逐段发送。 */
function splitAnswer(content: string, size = 12) {
  const characters = Array.from(content);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(""));
  }
  return chunks;
}

/** 向流中写入一个类型安全的 NDJSON 事件。 */
function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: ChatStreamEvent,
) {
  controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
}

/**
 * 创建或继续一个会话，执行 RAG，并通过 NDJSON 流返回阶段状态和答案增量。
 */
export async function POST(request: Request) {
  let body: ChatBody;

  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "请求体必须是有效 JSON" }, { status: 400 });
  }

  const question = body.message?.trim();
  if (!question) {
    return Response.json({ error: "message 不能为空" }, { status: 400 });
  }
  if (question.length > 10_000) {
    return Response.json({ error: "message 不能超过 10000 个字符" }, { status: 400 });
  }

  try {
    configureAiNetworkFromEnv();
    const repository = getConversationRepository();
    const existingConversation = body.conversationId
      ? repository.getConversation(body.conversationId)
      : undefined;

    if (body.conversationId && !existingConversation) {
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }

    const chatConfig = readChatProviderConfig({
      provider: existingConversation?.provider ?? body.provider,
      model: existingConversation?.model ?? body.model,
    });
    const embeddingConfig = readEmbeddingProviderConfig();
    const retrievalConfig = readRetrievalConfig();
    const vectorIndex = await loadVectorIndex(
      process.env.MINI_MAXKB_INDEX_PATH?.trim() ||
        ".mini-maxkb/l1-index.json",
    );
    assertIndexCompatible(vectorIndex, embeddingConfig);

    const chatProvider = createChatProvider(chatConfig);
    const embeddingProvider = createEmbeddingProvider(embeddingConfig);
    const conversation =
      existingConversation ??
      repository.createConversation({
        title: question,
        provider: chatProvider.id,
        model: chatProvider.model,
      });
    const history = existingConversation?.messages.map(({ role, content }) => ({
      role,
      content,
    }));
    repository.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: question,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          enqueueEvent(controller, { type: "conversation", conversation });
          enqueueEvent(controller, {
            type: "status",
            message: "正在检索知识库并生成答案…",
          });

          const result = await askKnowledgeBase(
            { chatProvider, embeddingProvider, index: vectorIndex },
            {
              question,
              topK: 3,
              systemPrompt: process.env.AI_SYSTEM_PROMPT,
              history,
              retrieval: retrievalConfig,
            },
          );
          const sources = toMessageSources(result.sources);
          const assistantMessage = repository.addMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: result.response.content,
            sources,
          });

          enqueueEvent(controller, {
            type: "retrieval",
            diagnostics: result.diagnostics,
          });
          enqueueEvent(controller, { type: "sources", sources });
          for (const content of splitAnswer(result.response.content)) {
            enqueueEvent(controller, { type: "delta", content });
          }
          enqueueEvent(controller, { type: "done", message: assistantMessage });
        } catch (error) {
          enqueueEvent(controller, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
