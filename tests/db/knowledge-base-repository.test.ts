import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";

import type { EmbeddingProvider } from "../../lib/ai/embedding-types";
import { KnowledgeBaseRepository } from "../../lib/db/knowledge-base-repository";
import { loadVectorIndex } from "../../lib/knowledge/vector-index";
import { rebuildKnowledgeBaseIndex } from "../../lib/knowledge-bases/indexer";

/** 创建不会访问外网的确定性向量供应商，专门验证建索引流程。 */
function createFakeEmbeddingProvider(): EmbeddingProvider {
  return {
    id: "gemini",
    model: "fake-embedding",
    dimensions: 2,
    async embed(request) {
      return {
        provider: "gemini",
        model: "fake-embedding",
        dimensions: 2,
        vectors: request.inputs.map((_, index) => [1, index / 10]),
      };
    },
  };
}

test("自定义知识库保存文档状态并生成独立向量索引", async () => {
  const root = path.join(tmpdir(), `mini-maxkb-l5a-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  const repository = new KnowledgeBaseRepository(
    path.join(root, "test.sqlite"),
    path.join(root, "storage"),
  );

  try {
    assert.equal(repository.listKnowledgeBases()[0].id, "default");
    const knowledgeBase = repository.createKnowledgeBase({
      name: "产品资料",
      description: "离线测试知识库",
    });
    const record = repository.getKnowledgeBaseRecord(knowledgeBase.id)!;
    const document = repository.createDocument({
      knowledgeBaseId: knowledgeBase.id,
      name: "manual.md",
      mimeType: "text/markdown",
      sizeBytes: 36,
    });
    writeFileSync(
      path.join(record.documentsPath, document.storedName),
      "# 产品手册\n\n支持创建多个互相隔离的知识库。",
      "utf8",
    );

    const result = await rebuildKnowledgeBaseIndex(
      repository,
      knowledgeBase.id,
      createFakeEmbeddingProvider(),
    );
    const index = await loadVectorIndex(record.indexPath);
    const detail = repository.getKnowledgeBase(knowledgeBase.id)!;

    assert.deepEqual(result, {
      documentCount: 1,
      indexedDocumentCount: 1,
      chunkCount: 1,
    });
    assert.equal(index.chunks[0].source, "manual.md");
    assert.match(index.chunks[0].id, new RegExp(`^${document.id}#0$`));
    assert.equal(detail.documents[0].status, "ready");
    assert.equal(detail.chunkCount, 1);
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});
