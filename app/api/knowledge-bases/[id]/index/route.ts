import { readEmbeddingProviderConfig } from "../../../../../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../../../../../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../../../../../lib/ai/network";
import { getKnowledgeBaseRepository } from "../../../../../lib/db/knowledge-base-repository";
import { rebuildKnowledgeBaseIndex } from "../../../../../lib/knowledge-bases/indexer";

export const runtime = "nodejs";

/** 手动重建自定义知识库索引，适用于模型配置变化或失败重试。 */
export async function POST(
  _request: Request,
  context: RouteContext<"/api/knowledge-bases/[id]/index">,
) {
  const { id } = await context.params;
  const repository = getKnowledgeBaseRepository();
  const knowledgeBase = repository.getKnowledgeBaseRecord(id);
  if (!knowledgeBase) {
    return Response.json({ error: "知识库不存在" }, { status: 404 });
  }
  if (knowledgeBase.isBuiltin) {
    return Response.json(
      { error: "默认示例知识库是只读的" },
      { status: 400 },
    );
  }

  try {
    configureAiNetworkFromEnv();
    const result = await rebuildKnowledgeBaseIndex(
      repository,
      id,
      createEmbeddingProvider(readEmbeddingProviderConfig()),
    );
    return Response.json({ indexing: result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
