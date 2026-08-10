import { getKnowledgeBaseRepository } from "../../../lib/db/knowledge-base-repository";

export const runtime = "nodejs";

interface CreateKnowledgeBaseBody {
  name?: string;
  description?: string;
}

/** 返回全部知识库，供聊天选择器和管理页使用。 */
export async function GET() {
  return Response.json({
    knowledgeBases: getKnowledgeBaseRepository().listKnowledgeBases(),
  });
}

/** 创建一个拥有独立文件目录和索引路径的自定义知识库。 */
export async function POST(request: Request) {
  let body: CreateKnowledgeBaseBody;
  try {
    body = (await request.json()) as CreateKnowledgeBaseBody;
  } catch {
    return Response.json({ error: "请求体必须是有效 JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return Response.json({ error: "知识库名称不能为空" }, { status: 400 });
  }

  try {
    const knowledgeBase = getKnowledgeBaseRepository().createKnowledgeBase({
      name,
      description: body.description,
    });
    return Response.json({ knowledgeBase }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
