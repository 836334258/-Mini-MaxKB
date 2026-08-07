import { getConversationRepository } from "../../../../lib/db/conversation-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回单个会话及其持久化消息；动态路由参数在 Next 16 中是 Promise。 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/conversations/[id]">,
) {
  const { id } = await context.params;
  const conversation = getConversationRepository().getConversation(id);

  if (!conversation) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  return Response.json({ conversation });
}
