import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ChatProviderId } from "../ai/types";
import type {
  ConversationDetail,
  ConversationSummary,
  MessageSource,
  StoredMessage,
} from "../conversations/types";

interface ConversationRow {
  id: string;
  title: string;
  provider: ChatProviderId;
  model: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources_json: string | null;
  created_at: string;
}

interface CreateConversationInput {
  title: string;
  provider: ChatProviderId;
  model: string;
}

interface AddMessageInput {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sources?: MessageSource[];
}

/** 将数据库字段名转换为供 API 和页面使用的会话对象。 */
function mapConversation(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 安全解析消息的来源快照；旧数据或损坏数据按空来源处理。 */
function parseSources(value: string | null): MessageSource[] {
  if (!value) {
    return [];
  }

  try {
    const sources = JSON.parse(value) as unknown;
    return Array.isArray(sources) ? (sources as MessageSource[]) : [];
  } catch {
    return [];
  }
}

/** 将数据库消息行转换成统一消息对象。 */
function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    sources: parseSources(row.sources_json),
    createdAt: row.created_at,
  };
}

export class ConversationRepository {
  private readonly database: Database.Database;

  /** 打开 SQLite 文件并自动创建 L3 所需的数据表和索引。 */
  constructor(databasePath = ".mini-maxkb/mini-maxkb.sqlite") {
    if (databasePath !== ":memory:") {
      const resolved = path.resolve(databasePath);
      mkdirSync(path.dirname(resolved), { recursive: true });
      databasePath = resolved;
    }

    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    if (databasePath !== ":memory:") {
      this.database.pragma("journal_mode = WAL");
    }
    this.migrate();
  }

  /** 使用幂等 SQL 初始化数据库结构，重复启动不会覆盖已有数据。 */
  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        sources_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
        ON messages(conversation_id, created_at, id);
      CREATE INDEX IF NOT EXISTS conversations_updated_idx
        ON conversations(updated_at DESC);
    `);
  }

  /** 创建会话并记录该会话固定使用的聊天供应商和模型。 */
  createConversation(input: CreateConversationInput): ConversationSummary {
    const now = new Date().toISOString();
    const conversation: ConversationSummary = {
      id: randomUUID(),
      title: input.title.trim().slice(0, 80) || "新对话",
      provider: input.provider,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(
        `INSERT INTO conversations
          (id, title, provider, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversation.id,
        conversation.title,
        conversation.provider,
        conversation.model,
        conversation.createdAt,
        conversation.updatedAt,
      );

    return conversation;
  }

  /** 按最近更新时间返回会话列表。 */
  listConversations(): ConversationSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all() as ConversationRow[];
    return rows.map(mapConversation);
  }

  /** 查询单个会话及其完整消息历史，不存在时返回 undefined。 */
  getConversation(id: string): ConversationDetail | undefined {
    const row = this.database
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;
    if (!row) {
      return undefined;
    }

    const messages = this.database
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(id) as MessageRow[];

    return { ...mapConversation(row), messages: messages.map(mapMessage) };
  }

  /** 写入一条消息，并在同一事务里更新会话的最近活动时间。 */
  addMessage(input: AddMessageInput): StoredMessage {
    const message: StoredMessage = {
      id: randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      sources: input.sources ?? [],
      createdAt: new Date().toISOString(),
    };
    const write = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO messages
            (id, conversation_id, role, content, sources_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          message.conversationId,
          message.role,
          message.content,
          message.sources.length > 0 ? JSON.stringify(message.sources) : null,
          message.createdAt,
        );
      this.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(message.createdAt, message.conversationId);
    });

    write();
    return message;
  }

  /** 关闭数据库连接，主要供测试和脚本释放文件句柄。 */
  close() {
    this.database.close();
  }
}

const globalDatabase = globalThis as typeof globalThis & {
  miniMaxKbConversationRepository?: ConversationRepository;
};

/**
 * 复用服务端 SQLite 连接，避免 Next 开发热更新期间反复创建数据库句柄。
 */
export function getConversationRepository() {
  if (!globalDatabase.miniMaxKbConversationRepository) {
    globalDatabase.miniMaxKbConversationRepository = new ConversationRepository(
      process.env.MINI_MAXKB_DATABASE_PATH?.trim() || undefined,
    );
  }

  return globalDatabase.miniMaxKbConversationRepository;
}
