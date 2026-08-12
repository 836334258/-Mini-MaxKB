import type {
  ConversationSummary,
  MessageSource,
  StoredMessage,
} from "../conversations/types";
import type { CourseRagResult } from "./rag-chain";

export interface CourseStreamSource {
  id?: string;
  source: string;
  title: string;
  chunkIndex: number;
  content: string;
}

export type CourseChatStreamEvent =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "status"; message: string }
  | { type: "rewrite"; standaloneQuestion: string }
  | { type: "sources"; sources: CourseStreamSource[] }
  | { type: "delta"; content: string }
  | { type: "done"; message: StoredMessage }
  | { type: "error"; message: string };

/** 把 LangChain Documents 转成适合通过 HTTP 发送的普通 JSON 对象。 */
export function toCourseStreamSources(
  sources: CourseRagResult["sources"],
): CourseStreamSource[] {
  return sources.map((document) => ({
    id: document.id,
    source: document.metadata.source,
    title: document.metadata.title,
    chunkIndex: document.metadata.chunkIndex,
    content: document.pageContent,
  }));
}

/**
 * 把课程来源转换成通用 SQLite 来源快照。
 * 标准 Retriever 本课只返回排序后的 Document，不公开相似度，因此 score 用 0 表示未采集。
 */
export function toStoredCourseSources(
  sources: CourseStreamSource[],
): MessageSource[] {
  return sources.map((source) => ({
    id: source.id ?? `${source.source}:${source.chunkIndex}`,
    source: source.source,
    title: source.title,
    position: source.chunkIndex,
    score: 0,
    content: source.content,
  }));
}

/** 把一个事件编码成一行 JSON；换行符是 NDJSON 的事件边界。 */
export function encodeCourseChatStreamEvent(event: CourseChatStreamEvent) {
  return `${JSON.stringify(event)}\n`;
}
