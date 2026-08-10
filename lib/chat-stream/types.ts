import type {
  ConversationSummary,
  MessageSource,
  StoredMessage,
} from "../conversations/types";
import type { RetrievalDiagnostics } from "../knowledge/hybrid-search";

export type ChatStreamEvent =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "status"; message: string }
  | { type: "retrieval"; diagnostics: RetrievalDiagnostics }
  | { type: "sources"; sources: MessageSource[] }
  | { type: "delta"; content: string }
  | { type: "done"; message: StoredMessage }
  | { type: "error"; message: string };

/** 将一个流事件编码成一行 NDJSON，便于浏览器逐行解析。 */
export function encodeChatStreamEvent(event: ChatStreamEvent) {
  return `${JSON.stringify(event)}\n`;
}
