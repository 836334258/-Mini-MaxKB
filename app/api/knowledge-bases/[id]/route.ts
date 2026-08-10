import { getKnowledgeBaseRepository } from "../../../../lib/db/knowledge-base-repository";

export const runtime = "nodejs";

/** 返回单个知识库及其文档状态。 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/knowledge-bases/[id]">,
) {
  const { id } = await context.params;
  const knowledgeBase = getKnowledgeBaseRepository().getKnowledgeBase(id);
  return knowledgeBase
    ? Response.json({ knowledgeBase })
    : Response.json({ error: "知识库不存在" }, { status: 404 });
}
