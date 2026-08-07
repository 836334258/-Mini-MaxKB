import { getConversationRepository } from "../../../lib/db/conversation-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回按最近活动时间排序的历史会话。 */
export function GET() {
  return Response.json({
    conversations: getConversationRepository().listConversations(),
  });
}
