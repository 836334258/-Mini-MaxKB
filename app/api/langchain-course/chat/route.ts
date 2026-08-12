import { configureAiNetworkFromEnv } from "../../../../lib/ai/network";
import type { ChatProviderId } from "../../../../lib/ai/types";
import {
  streamConversationalRag,
  type CourseConversationTurn,
} from "../../../../lib/langchain/conversational-rag";
import {
  encodeCourseChatStreamEvent,
  toCourseStreamSources,
  type CourseChatStreamEvent,
} from "../../../../lib/langchain/course-chat-stream";
import { openCourseConversationRepository } from "../../../../lib/langchain/course-conversation-store";
import { getCourseKnowledgeRuntime } from "../../../../lib/langchain/course-knowledge-runtime";
import { createCourseRetriever } from "../../../../lib/langchain/course-retriever";
import {
  configureCourseModelAuthentication,
  createCourseChatModel,
  readCourseModelConfig,
} from "../../../../lib/langchain/model-config";
import {
  storedMessagesToConversationTurns,
  toCourseModelProvider,
  toStoredChatProvider,
} from "../../../../lib/langchain/persistent-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CourseChatBody {
  conversationId?: string;
  message?: string;
  provider?: string;
  model?: string;
}

const encoder = new TextEncoder();

/** 把课程事件写成一个 NDJSON 数据块。 */
function enqueueEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: CourseChatStreamEvent,
) {
  controller.enqueue(encoder.encode(encodeCourseChatStreamEvent(event)));
}

/** 根据新会话选项或已有会话固定配置读取 ChatModel。 */
function readRequestModelConfig(
  body: CourseChatBody,
  storedProvider?: ChatProviderId,
  storedModel?: string,
) {
  return readCourseModelConfig({
    ...process.env,
    ...(storedProvider
      ? { LANGCHAIN_MODEL_PROVIDER: toCourseModelProvider(storedProvider) }
      : body.provider
        ? { LANGCHAIN_MODEL_PROVIDER: body.provider }
        : {}),
    ...(storedModel
      ? { LANGCHAIN_MODEL: storedModel }
      : body.model
        ? { LANGCHAIN_MODEL: body.model }
        : {}),
  });
}

/**
 * 创建或继续持久化会话，并流式返回检索阶段、来源和模型文本。
 */
export async function POST(request: Request) {
  let body: CourseChatBody;

  try {
    const rawBody = (await request.json()) as unknown;
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return Response.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
    }

    const fields = rawBody as Record<string, unknown>;
    body = {
      conversationId:
        typeof fields.conversationId === "string"
          ? fields.conversationId
          : undefined,
      message: typeof fields.message === "string" ? fields.message : undefined,
      provider:
        typeof fields.provider === "string" ? fields.provider : undefined,
      model: typeof fields.model === "string" ? fields.model : undefined,
    };
  } catch {
    return Response.json({ error: "请求体必须是有效 JSON" }, { status: 400 });
  }

  const question = body.message?.trim();
  if (!question) {
    return Response.json({ error: "message 不能为空" }, { status: 400 });
  }
  if (question.length > 10_000) {
    return Response.json(
      { error: "message 不能超过 10000 个字符" },
      { status: 400 },
    );
  }

  configureAiNetworkFromEnv();
  const repository = openCourseConversationRepository();

  try {
    const existingConversation = body.conversationId?.trim()
      ? repository.getConversation(body.conversationId.trim())
      : undefined;

    if (body.conversationId?.trim() && !existingConversation) {
      repository.close();
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }

    const modelConfig = readRequestModelConfig(
      body,
      existingConversation?.provider,
      existingConversation?.model,
    );
    configureCourseModelAuthentication(modelConfig);
    const history: CourseConversationTurn[] = existingConversation
      ? storedMessagesToConversationTurns(existingConversation.messages)
      : [];
    const conversation =
      existingConversation ??
      repository.createConversation({
        title: question,
        provider: toStoredChatProvider(modelConfig.modelProvider),
        model: modelConfig.model,
        knowledgeBaseId: "langchain-course",
      });

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
            message: "正在准备课程向量库…",
          });

          const knowledgeRuntime = await getCourseKnowledgeRuntime();
          enqueueEvent(controller, {
            type: "status",
            message: `正在从 ${knowledgeRuntime.sourceCount} 个来源、${knowledgeRuntime.chunkCount} 个片段中检索…`,
          });
          const retriever = createCourseRetriever(
            knowledgeRuntime.vectorStore,
            { k: 2 },
          );
          const chatModel = await createCourseChatModel(modelConfig);

          for await (const event of streamConversationalRag(
            retriever,
            { answerModel: chatModel },
            { question, history },
          )) {
            if (event.type === "rewrite") {
              enqueueEvent(controller, event);
            } else if (event.type === "sources") {
              enqueueEvent(controller, {
                type: "sources",
                sources: toCourseStreamSources(event.sources),
              });
            } else if (event.type === "delta") {
              enqueueEvent(controller, event);
            } else {
              const assistantMessage = repository.addMessage({
                conversationId: conversation.id,
                role: "assistant",
                content: event.result.answer,
              });
              enqueueEvent(controller, {
                type: "done",
                message: assistantMessage,
              });
            }
          }
        } catch (error) {
          enqueueEvent(controller, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          repository.close();
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
    repository.close();
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
