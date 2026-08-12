import { openCourseConversationRepository } from "../../../../../lib/langchain/course-conversation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CourseConversationRouteContext {
  params: Promise<{ id: string }>;
}

/** 根据动态路由中的 ID 返回课程会话和已持久化消息。 */
export async function GET(
  _request: Request,
  context: CourseConversationRouteContext,
) {
  const { id } = await context.params;
  const conversationId = id.trim();

  if (!conversationId) {
    return Response.json({ error: "conversationId 不能为空" }, { status: 400 });
  }

  const repository = openCourseConversationRepository();

  try {
    const conversation = repository.getConversation(conversationId);

    if (!conversation) {
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }

    return Response.json(
      { conversation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    repository.close();
  }
}
