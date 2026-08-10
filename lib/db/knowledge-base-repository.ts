import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  KnowledgeBaseDetail,
  KnowledgeBaseSummary,
  KnowledgeDocument,
  KnowledgeDocumentStatus,
} from "../knowledge-bases/types";

interface KnowledgeBaseRow {
  id: string;
  name: string;
  description: string;
  is_builtin: number;
  documents_path: string;
  index_path: string;
  chunk_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
}

interface KnowledgeDocumentRow {
  id: string;
  knowledge_base_id: string;
  name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  status: KnowledgeDocumentStatus;
  chunk_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseRecord extends KnowledgeBaseSummary {
  documentsPath: string;
  indexPath: string;
}

export interface KnowledgeDocumentRecord extends KnowledgeDocument {
  storedName: string;
}

/** 把数据库知识库行转换成不暴露服务端路径的页面对象。 */
function mapKnowledgeBase(row: KnowledgeBaseRow): KnowledgeBaseSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isBuiltin: Boolean(row.is_builtin),
    documentCount: row.document_count,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 把数据库文档行转换成统一文档对象。 */
function mapDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    chunkCount: row.chunk_count,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KnowledgeBaseRepository {
  private readonly database: Database.Database;
  private readonly storageRoot: string;

  /** 打开平台数据库，初始化知识库表，并确保内置示例知识库存在。 */
  constructor(
    databasePath = ".mini-maxkb/mini-maxkb.sqlite",
    storageRoot = ".mini-maxkb/knowledge-bases",
  ) {
    if (databasePath !== ":memory:") {
      const resolved = path.resolve(databasePath);
      mkdirSync(path.dirname(resolved), { recursive: true });
      databasePath = resolved;
    }
    this.storageRoot = path.resolve(storageRoot);
    mkdirSync(this.storageRoot, { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    if (databasePath !== ":memory:") {
      this.database.pragma("journal_mode = WAL");
    }
    this.migrate();
    this.ensureBuiltinKnowledgeBase();
  }

  /** 创建知识库、文档表和查询索引；重复启动不会清空已有数据。 */
  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        documents_path TEXT NOT NULL,
        index_path TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        knowledge_base_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('indexing', 'ready', 'error')),
        chunk_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS knowledge_documents_base_created_idx
        ON knowledge_documents(knowledge_base_id, created_at, id);
      CREATE INDEX IF NOT EXISTS knowledge_bases_updated_idx
        ON knowledge_bases(updated_at DESC);
    `);
  }

  /** 注册指向 L1–L4 全局索引的只读内置知识库。 */
  private ensureBuiltinKnowledgeBase() {
    const now = new Date().toISOString();
    const documentsPath = path.join(
      this.storageRoot,
      "default",
      "documents",
    );
    const indexPath = path.resolve(/*turbopackIgnore: true*/
      process.env.MINI_MAXKB_INDEX_PATH?.trim() ||
        ".mini-maxkb/l1-index.json",
    );
    const chunkCount = this.readBuiltinChunkCount(indexPath);
    this.database
      .prepare(
        `INSERT INTO knowledge_bases
          (id, name, description, is_builtin, documents_path, index_path, chunk_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           documents_path = excluded.documents_path,
           index_path = excluded.index_path,
           chunk_count = excluded.chunk_count`,
      )
      .run(
        "default",
        "默认示例知识库",
        "L1–L4 使用的内置学习文档和索引，只读保留。",
        1,
        documentsPath,
        indexPath,
        chunkCount,
        now,
        now,
      );
  }

  /** 仅读取内置 JSON 索引的分段数量；索引缺失或损坏时安全回退为 0。 */
  private readBuiltinChunkCount(indexPath: string) {
    try {
      const index = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ indexPath, "utf8"),
      ) as { chunks?: unknown[] };
      return Array.isArray(index.chunks) ? index.chunks.length : 0;
    } catch {
      return 0;
    }
  }

  /** 创建一个拥有独立文档目录和向量索引的新知识库。 */
  createKnowledgeBase(input: {
    name: string;
    description?: string;
  }): KnowledgeBaseSummary {
    const name = input.name.trim();
    if (!name) {
      throw new Error("知识库名称不能为空");
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const basePath = path.join(this.storageRoot, id);
    const documentsPath = path.join(basePath, "documents");
    const indexPath = path.join(basePath, "index.json");
    mkdirSync(documentsPath, { recursive: true });

    this.database
      .prepare(
        `INSERT INTO knowledge_bases
          (id, name, description, is_builtin, documents_path, index_path, chunk_count, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        name.slice(0, 80),
        input.description?.trim().slice(0, 500) ?? "",
        documentsPath,
        indexPath,
        now,
        now,
      );

    return this.getKnowledgeBase(id)!;
  }

  /** 返回全部知识库及其文档数量，内置库固定排在最前。 */
  listKnowledgeBases(): KnowledgeBaseSummary[] {
    const rows = this.database
      .prepare(
        `SELECT kb.*, COUNT(doc.id) AS document_count
         FROM knowledge_bases kb
         LEFT JOIN knowledge_documents doc ON doc.knowledge_base_id = kb.id
         GROUP BY kb.id
         ORDER BY kb.is_builtin DESC, kb.updated_at DESC`,
      )
      .all() as KnowledgeBaseRow[];
    return rows.map(mapKnowledgeBase);
  }

  /** 返回知识库详情和上传文档，不向客户端暴露磁盘路径。 */
  getKnowledgeBase(id: string): KnowledgeBaseDetail | undefined {
    const record = this.getKnowledgeBaseRecord(id);
    if (!record) {
      return undefined;
    }

    return {
      ...record,
      documents: this.listDocumentRecords(id).map((document) => ({
        id: document.id,
        knowledgeBaseId: document.knowledgeBaseId,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        status: document.status,
        chunkCount: document.chunkCount,
        errorMessage: document.errorMessage,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })),
    };
  }

  /** 返回服务端建索引所需的知识库磁盘路径。 */
  getKnowledgeBaseRecord(id: string): KnowledgeBaseRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT kb.*, COUNT(doc.id) AS document_count
         FROM knowledge_bases kb
         LEFT JOIN knowledge_documents doc ON doc.knowledge_base_id = kb.id
         WHERE kb.id = ?
         GROUP BY kb.id`,
      )
      .get(id) as KnowledgeBaseRow | undefined;
    if (!row) {
      return undefined;
    }

    return {
      ...mapKnowledgeBase(row),
      documentsPath: row.documents_path,
      indexPath: row.index_path,
    };
  }

  /** 创建处于索引中的文档记录，并生成不会与同名文件冲突的存储名称。 */
  createDocument(input: {
    knowledgeBaseId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }): KnowledgeDocumentRecord {
    const id = randomUUID();
    const extension = path.extname(input.name).toLowerCase();
    const storedName = `${id}${extension}`;
    const now = new Date().toISOString();

    this.database
      .prepare(
        `INSERT INTO knowledge_documents
          (id, knowledge_base_id, name, stored_name, mime_type, size_bytes, status, chunk_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'indexing', 0, ?, ?)`,
      )
      .run(
        id,
        input.knowledgeBaseId,
        input.name,
        storedName,
        input.mimeType,
        input.sizeBytes,
        now,
        now,
      );

    return this.getDocumentRecord(id)!;
  }

  /** 返回一个包含服务端存储名称的文档记录。 */
  getDocumentRecord(id: string): KnowledgeDocumentRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM knowledge_documents WHERE id = ?")
      .get(id) as KnowledgeDocumentRow | undefined;
    return row
      ? { ...mapDocument(row), storedName: row.stored_name }
      : undefined;
  }

  /** 返回知识库全部文档记录，供重建索引读取文件。 */
  listDocumentRecords(knowledgeBaseId: string): KnowledgeDocumentRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM knowledge_documents
         WHERE knowledge_base_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(knowledgeBaseId) as KnowledgeDocumentRow[];
    return rows.map((row) => ({
      ...mapDocument(row),
      storedName: row.stored_name,
    }));
  }

  /** 标记单个文档的索引结果。 */
  updateDocumentStatus(
    id: string,
    status: KnowledgeDocumentStatus,
    chunkCount: number,
    errorMessage?: string,
  ) {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE knowledge_documents
         SET status = ?, chunk_count = ?, error_message = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, chunkCount, errorMessage ?? null, now, id);
  }

  /** 更新知识库的总分段数和最近索引时间。 */
  updateChunkCount(id: string, chunkCount: number) {
    this.database
      .prepare(
        `UPDATE knowledge_bases
         SET chunk_count = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(chunkCount, new Date().toISOString(), id);
  }

  /** 关闭数据库连接，供测试释放句柄。 */
  close() {
    this.database.close();
  }
}

const globalKnowledgeDatabase = globalThis as typeof globalThis & {
  miniMaxKbKnowledgeBaseRepository?: KnowledgeBaseRepository;
  miniMaxKbKnowledgeBaseRepositoryVersion?: number;
};

const KNOWLEDGE_BASE_REPOSITORY_VERSION = 1;

/** 复用 Next 服务端知识库仓储，避免开发热更新重复打开连接。 */
export function getKnowledgeBaseRepository() {
  if (
    globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepository &&
    globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepositoryVersion !==
      KNOWLEDGE_BASE_REPOSITORY_VERSION
  ) {
    globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepository.close();
    globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepository = undefined;
  }

  if (!globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepository) {
    globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepository =
      new KnowledgeBaseRepository(
        process.env.MINI_MAXKB_DATABASE_PATH?.trim() || undefined,
        process.env.MINI_MAXKB_STORAGE_PATH?.trim() || undefined,
      );
    globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepositoryVersion =
      KNOWLEDGE_BASE_REPOSITORY_VERSION;
  }
  return globalKnowledgeDatabase.miniMaxKbKnowledgeBaseRepository;
}
