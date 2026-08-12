import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { resolveCourseDatabasePath } from "./course-conversation-store";

export type CourseRunStatus = "success" | "error";
export type CourseRunStage =
  | "configuration"
  | "knowledge"
  | "retrieval"
  | "generation"
  | "persistence"
  | "unknown";

export interface CourseRunRecord {
  id: string;
  conversationId?: string;
  provider: string;
  model: string;
  status: CourseRunStatus;
  sourceCount: number;
  retrievalMs: number;
  generationMs: number;
  totalMs: number;
  errorStage?: CourseRunStage;
  errorMessage?: string;
  createdAt: string;
}

export interface CourseRunSummary {
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  averageRetrievalMs: number;
  averageGenerationMs: number;
  averageTotalMs: number;
  p95TotalMs: number;
}

interface CourseRunRow {
  id: string;
  conversation_id: string | null;
  provider: string;
  model: string;
  status: CourseRunStatus;
  source_count: number;
  retrieval_ms: number;
  generation_ms: number;
  total_ms: number;
  error_stage: CourseRunStage | null;
  error_message: string | null;
  created_at: string;
}

type CreateCourseRunInput = Omit<CourseRunRecord, "id" | "createdAt">;

/** 把数据库行转换成可通过 HTTP 返回的驼峰对象。 */
function mapCourseRun(row: CourseRunRow): CourseRunRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? undefined,
    provider: row.provider,
    model: row.model,
    status: row.status,
    sourceCount: row.source_count,
    retrievalMs: row.retrieval_ms,
    generationMs: row.generation_ms,
    totalMs: row.total_ms,
    errorStage: row.error_stage ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  };
}

/** 将耗时归一化为非负整数毫秒，避免浮点噪声进入指标。 */
export function toDurationMs(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** 计算离散样本的 nearest-rank P95。 */
export function percentile95(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

export class CourseObservabilityRepository {
  private readonly database: Database.Database;

  /** 打开课程 SQLite，并幂等创建不含问题正文的运行指标表。 */
  constructor(databasePath = resolveCourseDatabasePath()) {
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
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS course_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'error')),
        source_count INTEGER NOT NULL,
        retrieval_ms INTEGER NOT NULL,
        generation_ms INTEGER NOT NULL,
        total_ms INTEGER NOT NULL,
        error_stage TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS course_runs_created_idx
        ON course_runs(created_at DESC);
    `);
  }

  /** 追加一条终态运行记录；不保存问题正文、Prompt 或 API Key。 */
  recordRun(input: CreateCourseRunInput): CourseRunRecord {
    const record: CourseRunRecord = {
      ...input,
      id: randomUUID(),
      sourceCount: Math.max(0, Math.trunc(input.sourceCount)),
      retrievalMs: toDurationMs(input.retrievalMs),
      generationMs: toDurationMs(input.generationMs),
      totalMs: toDurationMs(input.totalMs),
      errorMessage: input.errorMessage?.slice(0, 500),
      createdAt: new Date().toISOString(),
    };

    this.database
      .prepare(
        `INSERT INTO course_runs
          (id, conversation_id, provider, model, status, source_count,
           retrieval_ms, generation_ms, total_ms, error_stage, error_message,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.conversationId ?? null,
        record.provider,
        record.model,
        record.status,
        record.sourceCount,
        record.retrievalMs,
        record.generationMs,
        record.totalMs,
        record.errorStage ?? null,
        record.errorMessage ?? null,
        record.createdAt,
      );

    return record;
  }

  /** 返回最近运行，供本地诊断慢请求和失败阶段。 */
  listRecentRuns(limit = 20): CourseRunRecord[] {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error("运行记录 limit 必须是 1 到 100 的整数");
    }
    const rows = this.database
      .prepare("SELECT * FROM course_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as CourseRunRow[];
    return rows.map(mapCourseRun);
  }

  /** 汇总最近 100 次运行的平均耗时、错误数和 P95 总耗时。 */
  summarizeRecentRuns(): CourseRunSummary {
    const runs = this.listRecentRuns(100);
    const successes = runs.filter((run) => run.status === "success");
    const average = (values: number[]) =>
      values.length === 0
        ? 0
        : Math.round(
            values.reduce((total, value) => total + value, 0) / values.length,
          );

    return {
      totalRuns: runs.length,
      successRuns: successes.length,
      errorRuns: runs.length - successes.length,
      averageRetrievalMs: average(
        successes.map((run) => run.retrievalMs),
      ),
      averageGenerationMs: average(
        successes.map((run) => run.generationMs),
      ),
      averageTotalMs: average(successes.map((run) => run.totalMs)),
      p95TotalMs: percentile95(successes.map((run) => run.totalMs)),
    };
  }

  close() {
    this.database.close();
  }
}

/** 记录观测数据失败时不影响主聊天响应。 */
export function recordCourseRunSafely(input: CreateCourseRunInput) {
  let repository: CourseObservabilityRepository | undefined;
  try {
    repository = new CourseObservabilityRepository();
    repository.recordRun(input);
  } catch (error) {
    console.error(
      "LC12 运行指标写入失败：",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    repository?.close();
  }
}
