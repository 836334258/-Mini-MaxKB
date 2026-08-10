import { writeFile } from "node:fs/promises";
import path from "node:path";

import { readEmbeddingProviderConfig } from "../../../../../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../../../../../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../../../../../lib/ai/network";
import { getKnowledgeBaseRepository } from "../../../../../lib/db/knowledge-base-repository";
import { rebuildKnowledgeBaseIndex } from "../../../../../lib/knowledge-bases/indexer";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

/** 校验并保存单个文本文件，然后重建该知识库的独立向量索引。 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/knowledge-bases/[id]/documents">,
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "上传内容必须是表单数据" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "请选择要上传的文件" }, { status: 400 });
  }

  const originalName = path.basename(file.name).slice(0, 180);
  const extension = path.extname(originalName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return Response.json(
      { error: "当前只支持 .md 和 .txt 文件" },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: "文件必须大于 0 字节且不能超过 2 MB" },
      { status: 400 },
    );
  }

  const content = (await file.text()).replace(/^\uFEFF/, "").trim();
  if (!content) {
    return Response.json({ error: "文件没有可索引内容" }, { status: 400 });
  }

  const document = repository.createDocument({
    knowledgeBaseId: id,
    name: originalName,
    mimeType: file.type || "text/plain",
    sizeBytes: file.size,
  });

  try {
    await writeFile(
      path.join(knowledgeBase.documentsPath, document.storedName),
      content,
      "utf8",
    );
    configureAiNetworkFromEnv();
    const embeddingProvider = createEmbeddingProvider(
      readEmbeddingProviderConfig(),
    );
    const indexing = await rebuildKnowledgeBaseIndex(
      repository,
      id,
      embeddingProvider,
    );
    return Response.json(
      {
        document: repository.getDocumentRecord(document.id),
        indexing,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    repository.updateDocumentStatus(document.id, "error", 0, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
