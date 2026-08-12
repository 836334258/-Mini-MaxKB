import { configureAiNetworkFromEnv } from "../../../../lib/ai/network";
import type { ChatProviderId } from "../../../../lib/ai/types";
import {
  streamConversationalRag,
  type CourseConversationTurn,
} from "../../../../lib/langchain/conversational-rag";
import {
  encodeCourseChatStreamEvent,
  toCourseStreamSources,
  toStoredCourseSources,
  type CourseChatStreamEvent,
} from "../../../../lib/langchain/course-chat-stream";
import { openCourseConversationRepository } from "../../../../lib/langchain/course-conversation-store";
import { getCourseKnowledgeRuntime } from "../../../../lib/langchain/course-knowledge-runtime";
import {
  recordCourseRunSafely,
  type CourseRunStage,
} from "../../../../lib/langchain/course-observability";
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

  const requestStartedAt = performance.now();
  let runRecorded = false;
  let runConversationId = body.conversationId?.trim() || undefined;
  let runProvider = body.provider?.trim() || "unknown";
  let runModel = body.model?.trim() || "unknown";

  /** 每个请求只追加一条终态指标，避免成功和异常路径重复记录。 */
  function recordTerminalRun(input: {
    status: "success" | "error";
    sourceCount: number;
    retrievalMs: number;
    generationMs: number;
    errorStage?: CourseRunStage;
    errorMessage?: string;
  }) {
    if (runRecorded) {
      return;
    }
    runRecorded = true;
    recordCourseRunSafely({
      conversationId: runConversationId,
      provider: runProvider,
      model: runModel,
      totalMs: performance.now() - requestStartedAt,
      ...input,
    });
  }

  configureAiNetworkFromEnv();
  const repository = openCourseConversationRepository();

  try {
    const existingConversation = body.conversationId?.trim()
      ? repository.getConversation(body.conversationId.trim())
      : undefined;

    if (body.conversationId?.trim() && !existingConversation) {
      recordTerminalRun({
        status: "error",
        sourceCount: 0,
        retrievalMs: 0,
        generationMs: 0,
        errorStage: "configuration",
        errorMessage: "会话不存在",
      });
      repository.close();
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }

    const modelConfig = readRequestModelConfig(
      body,
      existingConversation?.provider,
      existingConversation?.model,
    );
    runProvider = modelConfig.modelProvider;
    runModel = modelConfig.model;
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
    runConversationId = conversation.id;

    repository.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: question,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let stage: CourseRunStage = "knowledge";
        let retrievalStartedAt = 0;
        let sourcesReceivedAt = 0;
        let sourceCount = 0;

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
          stage = "retrieval";
          retrievalStartedAt = performance.now();

          for await (const event of streamConversationalRag(
            retriever,
            { answerModel: chatModel },
            { question, history },
          )) {
            if (event.type === "rewrite") {
              enqueueEvent(controller, event);
            } else if (event.type === "sources") {
              sourcesReceivedAt = performance.now();
              sourceCount = event.sources.length;
              stage = "generation";
              enqueueEvent(controller, {
                type: "sources",
                sources: toCourseStreamSources(event.sources),
              });
            } else if (event.type === "delta") {
              enqueueEvent(controller, event);
            } else {
              const generationFinishedAt = performance.now();
              stage = "persistence";
              const sourceSnapshots = toCourseStreamSources(
                event.result.sources,
              );
              const assistantMessage = repository.addMessage({
                conversationId: conversation.id,
                role: "assistant",
                content: event.result.answer,
                sources: toStoredCourseSources(sourceSnapshots),
              });
              recordTerminalRun({
                status: "success",
                sourceCount,
                retrievalMs:
                  sourcesReceivedAt > 0 && retrievalStartedAt > 0
                    ? sourcesReceivedAt - retrievalStartedAt
                    : 0,
                generationMs:
                  sourcesReceivedAt > 0
                    ? generationFinishedAt - sourcesReceivedAt
                    : 0,
              });
              enqueueEvent(controller, {
                type: "done",
                message: assistantMessage,
              });
            }
          }
        } catch (error) {
          const failedAt = performance.now();
          const message = error instanceof Error ? error.message : String(error);
          recordTerminalRun({
            status: "error",
            sourceCount,
            retrievalMs:
              retrievalStartedAt > 0
                ? (sourcesReceivedAt || failedAt) - retrievalStartedAt
                : 0,
            generationMs:
              sourcesReceivedAt > 0 ? failedAt - sourcesReceivedAt : 0,
            errorStage: stage,
            errorMessage: message,
          });
          enqueueEvent(controller, {
            type: "error",
            message,
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
    recordTerminalRun({
      status: "error",
      sourceCount: 0,
      retrievalMs: 0,
      generationMs: 0,
      errorStage: "configuration",
      errorMessage: message,
    });
    return Response.json({ error: message }, { status: 400 });
  }
}
