import type { ChatProviderId } from "../ai/types";
import type { StoredMessage } from "../conversations/types";
import type { ConversationRepository } from "../db/conversation-repository";
import type {
  CourseConversationTurn,
} from "./conversational-rag";
import type { CourseModelProvider } from "./model-config";

/** 把 LangChain 课程的 provider 名称转换成现有会话表使用的名称。 */
export function toStoredChatProvider(
  provider: CourseModelProvider,
): ChatProviderId {
  return provider === "google-genai" ? "gemini" : provider;
}

/** 把数据库中的 provider 名称恢复成 initChatModel 使用的名称。 */
export function toCourseModelProvider(
  provider: ChatProviderId,
): CourseModelProvider {
  return provider === "gemini" ? "google-genai" : provider;
}

/**
 * 把数据库消息按 user → assistant 配成对话轮次。
 * 崩溃留下的孤立消息不会进入历史，避免角色顺序错乱后污染 Prompt。
 */
export function storedMessagesToConversationTurns(
  messages: StoredMessage[],
): CourseConversationTurn[] {
  const turns: CourseConversationTurn[] = [];
  let pendingQuestion: string | undefined;

  for (const message of messages) {
    const content = message.content.trim();

    if (message.role === "user") {
      pendingQuestion = content || undefined;
      continue;
    }

    if (pendingQuestion && content) {
      turns.push({
        question: pendingQuestion,
        answer: content,
      });
      pendingQuestion = undefined;
    }
  }

  return turns;
}

/** 根据 conversationId 读取会话及可供 LC6 使用的完整问答历史。 */
export function loadPersistentCourseConversation(
  repository: ConversationRepository,
  conversationId: string,
) {
  const normalizedId = conversationId.trim();

  if (!normalizedId) {
    throw new Error("conversationId 不能为空");
  }

  const conversation = repository.getConversation(normalizedId);
  if (!conversation) {
    throw new Error(`会话不存在：${normalizedId}`);
  }

  return {
    conversation,
    history: storedMessagesToConversationTurns(conversation.messages),
  };
}

/**
 * 在 RAG 成功后写入一轮 user/assistant 消息。
 * LC7 聚焦历史恢复；来源快照仍由现有 Web RAG 流程负责持久化。
 */
export function savePersistentCourseTurn(
  repository: ConversationRepository,
  conversationId: string,
  turn: CourseConversationTurn,
) {
  const question = turn.question.trim();
  const answer = turn.answer.trim();

  if (!question || !answer) {
    throw new Error("持久化的对话问题和回答不能为空");
  }

  const userMessage = repository.addMessage({
    conversationId,
    role: "user",
    content: question,
  });
  const assistantMessage = repository.addMessage({
    conversationId,
    role: "assistant",
    content: answer,
  });

  return { userMessage, assistantMessage };
}
