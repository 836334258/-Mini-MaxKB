import { ConversationRepository } from "../db/conversation-repository";

export const DEFAULT_COURSE_DATABASE_PATH =
  ".mini-maxkb/lc7-course.sqlite";

/** 统一解析课程 SQLite 路径，供会话和观测仓库复用。 */
export function resolveCourseDatabasePath(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.LANGCHAIN_COURSE_DATABASE_PATH?.trim() ||
    DEFAULT_COURSE_DATABASE_PATH
  );
}

/**
 * 为 LangChain 课程接口打开独立的 SQLite 会话仓库。
 *
 * Chat POST 和会话 GET 必须经过同一个入口读取路径，避免分别连接到不同文件。
 */
export function openCourseConversationRepository(
  environment: Record<string, string | undefined> = process.env,
) {
  return new ConversationRepository(resolveCourseDatabasePath(environment));
}
