import type {
  ConversationDetail,
  ConversationSummary,
} from "../conversations/types";
import type { CourseChatStreamEvent } from "./course-chat-stream";

/** 从非 2xx 响应中尽量提取服务端返回的错误说明。 */
async function readResponseError(response: Response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // 服务端不一定返回 JSON，解析失败时继续使用原始文本或状态码。
  }

  return text.trim() || `请求失败：HTTP ${response.status}`;
}

/** 根据会话 ID 从 SQLite 对应的服务端接口恢复完整课程会话。 */
export async function fetchCourseConversation(
  conversationId: string,
  fetcher: typeof fetch = fetch,
) {
  const normalizedId = conversationId.trim();
  if (!normalizedId) {
    throw new Error("conversationId 不能为空");
  }

  const response = await fetcher(
    `/api/langchain-course/conversations/${encodeURIComponent(normalizedId)}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const body = (await response.json()) as {
    conversation?: ConversationDetail;
  };
  if (!body.conversation) {
    throw new Error("服务端没有返回会话数据");
  }

  return body.conversation;
}

/** 获取按最近活动排序的课程会话摘要列表。 */
export async function fetchCourseConversations(
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/langchain-course/conversations", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const body = (await response.json()) as {
    conversations?: ConversationSummary[];
  };
  if (!Array.isArray(body.conversations)) {
    throw new Error("服务端没有返回会话列表");
  }

  return body.conversations;
}

/**
 * 持续读取课程接口的 NDJSON 响应，并在每一行完整到达时通知调用方。
 *
 * fetch 收到的 value 只是任意大小的字节块，一条 JSON 可能被拆成多块，
 * 多条 JSON 也可能合并在同一块中，因此必须使用 buffer 按换行符组装。
 */
export async function consumeCourseChatStream(
  response: Response,
  onEvent: (event: CourseChatStreamEvent) => void,
) {
  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }
  if (!response.body) {
    throw new Error("浏览器没有收到流式响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      // stream: true 会保留被拆开的 UTF-8 中文字符，等待下一个字节块。
      buffer += decoder.decode(value, { stream: true });
    }
    if (done) {
      buffer += decoder.decode();
    }

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        onEvent(JSON.parse(line) as CourseChatStreamEvent);
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  // 兼容最后一条 JSON 没有换行符的服务端实现。
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as CourseChatStreamEvent);
  }
}
