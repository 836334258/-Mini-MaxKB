import { openCourseConversationRepository } from "../../../../lib/langchain/course-conversation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回课程 SQLite 中的会话摘要，列表接口不携带完整消息。 */
export async function GET() {
  const repository = openCourseConversationRepository();

  try {
    const conversations = repository
      .listConversations()
      .filter(
        (conversation) => conversation.knowledgeBaseId === "langchain-course",
      );

    return Response.json(
      { conversations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    repository.close();
  }
}
