"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type {
  KnowledgeBaseDetail,
  KnowledgeBaseSummary,
} from "../../lib/knowledge-bases/types";
import styles from "./page.module.css";

/** 请求 JSON 接口，并统一提取服务端返回的中文错误。 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `请求失败：HTTP ${response.status}`);
  }
  return body;
}

/** 将字节数转换成适合页面阅读的文件大小。 */
function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 将 ISO 时间格式化成本地日期和分钟。 */
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function KnowledgeBasesPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState("default");
  const [detail, setDetail] = useState<KnowledgeBaseDetail>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("正在加载知识库…");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 刷新知识库列表，可在创建后直接切换到指定知识库。 */
  async function refreshKnowledgeBases(preferredId?: string) {
    const result = await requestJson<{ knowledgeBases: KnowledgeBaseSummary[] }>(
      "/api/knowledge-bases",
    );
    setKnowledgeBases(result.knowledgeBases);
    const nextId =
      preferredId ??
      (result.knowledgeBases.some((item) => item.id === selectedId)
        ? selectedId
        : result.knowledgeBases[0]?.id);
    if (nextId) {
      setSelectedId(nextId);
    }
    return nextId;
  }

  /** 加载知识库详情，展示文档的索引状态与分段数。 */
  async function loadDetail(id: string) {
    const result = await requestJson<{ knowledgeBase: KnowledgeBaseDetail }>(
      `/api/knowledge-bases/${encodeURIComponent(id)}`,
    );
    setDetail(result.knowledgeBase);
    return result.knowledgeBase;
  }

  useEffect(() => {
    async function initialize() {
      try {
        const listResult = await requestJson<{
          knowledgeBases: KnowledgeBaseSummary[];
        }>("/api/knowledge-bases");
        setKnowledgeBases(listResult.knowledgeBases);
        const id = listResult.knowledgeBases.some((item) => item.id === "default")
          ? "default"
          : listResult.knowledgeBases[0]?.id;
        if (id) {
          setSelectedId(id);
          const detailResult = await requestJson<{
            knowledgeBase: KnowledgeBaseDetail;
          }>(`/api/knowledge-bases/${encodeURIComponent(id)}`);
          setDetail(detailResult.knowledgeBase);
        }
        setStatus("准备就绪");
      } catch (initializationError) {
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : String(initializationError),
        );
      }
    }

    void initialize();
  }, []);

  /** 用户切换左侧知识库时，从服务端获取最新文档状态。 */
  async function selectKnowledgeBase(id: string) {
    setSelectedId(id);
    setError("");
    setStatus("正在读取知识库…");
    try {
      await loadDetail(id);
      setStatus("准备就绪");
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : String(selectionError),
      );
    }
  }

  /** 创建空知识库；创建完成后自动选中，等待上传第一份文档。 */
  async function createKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isCreating) {
      return;
    }

    setIsCreating(true);
    setError("");
    setStatus("正在创建知识库…");
    try {
      const result = await requestJson<{ knowledgeBase: KnowledgeBaseSummary }>(
        "/api/knowledge-bases",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        },
      );
      setName("");
      setDescription("");
      await refreshKnowledgeBases(result.knowledgeBase.id);
      await loadDetail(result.knowledgeBase.id);
      setStatus("知识库已创建，请上传 .md 或 .txt 文档");
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : String(creationError),
      );
      setStatus("创建失败");
    } finally {
      setIsCreating(false);
    }
  }

  /** 上传单个文档；服务端保存文件后会自动重建该知识库的完整索引。 */
  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !detail || isIndexing) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setIsIndexing(true);
    setError("");
    setStatus(`正在上传并索引 ${file.name}…`);
    try {
      await requestJson(
        `/api/knowledge-bases/${encodeURIComponent(detail.id)}/documents`,
        { method: "POST", body: formData },
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await refreshKnowledgeBases(detail.id);
      const latest = await loadDetail(detail.id);
      setStatus(`索引完成，共 ${latest.chunkCount} 个知识分段`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : String(uploadError),
      );
      await loadDetail(detail.id).catch(() => undefined);
      setStatus("上传或索引失败");
    } finally {
      setIsIndexing(false);
    }
  }

  /** 手动重新读取全部文档并生成索引。 */
  async function rebuildIndex() {
    if (!detail || isIndexing) {
      return;
    }
    setIsIndexing(true);
    setError("");
    setStatus("正在重建全部文档索引…");
    try {
      await requestJson(
        `/api/knowledge-bases/${encodeURIComponent(detail.id)}/index`,
        { method: "POST" },
      );
      await refreshKnowledgeBases(detail.id);
      const latest = await loadDetail(detail.id);
      setStatus(`重建完成，共 ${latest.chunkCount} 个知识分段`);
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : String(indexError));
      await loadDetail(detail.id).catch(() => undefined);
      setStatus("索引重建失败");
    } finally {
      setIsIndexing(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>L5A · KNOWLEDGE BASES</p>
          <h1>知识库管理</h1>
          <span>每个自定义知识库都有独立文档目录和向量索引。</span>
        </div>
        <Link href="/">返回知识问答</Link>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <section className={styles.createCard}>
            <h2>新建知识库</h2>
            <form onSubmit={createKnowledgeBase}>
              <input
                aria-label="知识库名称"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：产品使用手册"
                value={name}
              />
              <textarea
                aria-label="知识库描述"
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="这套资料用于回答什么问题？"
                rows={3}
                value={description}
              />
              <button disabled={!name.trim() || isCreating} type="submit">
                {isCreating ? "创建中…" : "创建空知识库"}
              </button>
            </form>
          </section>

          <nav className={styles.baseList} aria-label="知识库列表">
            {knowledgeBases.map((knowledgeBase) => (
              <button
                className={knowledgeBase.id === selectedId ? styles.activeBase : ""}
                key={knowledgeBase.id}
                onClick={() => void selectKnowledgeBase(knowledgeBase.id)}
              >
                <span>
                  <strong>{knowledgeBase.name}</strong>
                  {knowledgeBase.isBuiltin && <i>内置</i>}
                </span>
                <small>
                  {knowledgeBase.documentCount} 文档 · {knowledgeBase.chunkCount} 分段
                </small>
              </button>
            ))}
          </nav>
        </aside>

        <section className={styles.content}>
          {detail && (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.titleLine}>
                    <h2>{detail.name}</h2>
                    {detail.isBuiltin && <span>只读内置库</span>}
                  </div>
                  <p>{detail.description || "暂未填写说明。"}</p>
                </div>
                <div className={styles.stats}>
                  <div><strong>{detail.documentCount}</strong><span>文档</span></div>
                  <div><strong>{detail.chunkCount}</strong><span>分段</span></div>
                </div>
              </div>

              {detail.isBuiltin ? (
                <div className={styles.readonlyNotice}>
                  默认示例知识库继续使用 L1–L4 的全局索引。为了保护学习基线，这里不允许上传或重建。
                </div>
              ) : (
                <div className={styles.actions}>
                  <form onSubmit={uploadDocument}>
                    <input
                      accept=".md,.txt,text/markdown,text/plain"
                      aria-label="上传知识文档"
                      disabled={isIndexing}
                      ref={fileInputRef}
                      required
                      type="file"
                    />
                    <button disabled={isIndexing} type="submit">
                      {isIndexing ? "处理中…" : "上传并索引"}
                    </button>
                  </form>
                  <button
                    disabled={isIndexing || detail.documents.length === 0}
                    onClick={() => void rebuildIndex()}
                    type="button"
                  >
                    重建全部索引
                  </button>
                  <small>支持 UTF-8 的 .md/.txt，单文件最大 2 MB。</small>
                </div>
              )}

              <div className={styles.documentSection}>
                <h3>文档与索引状态</h3>
                {detail.documents.length === 0 ? (
                  <div className={styles.emptyDocuments}>
                    {detail.isBuiltin
                      ? "内置索引由 L1–L4 脚本维护，不在这里登记文档。"
                      : "还没有文档。上传第一份资料后会自动生成独立索引。"}
                  </div>
                ) : (
                  <div className={styles.documentList}>
                    {detail.documents.map((document) => (
                      <article key={document.id}>
                        <div>
                          <strong>{document.name}</strong>
                          <span>
                            {formatBytes(document.sizeBytes)} · {formatTime(document.updatedAt)}
                          </span>
                          {document.errorMessage && <em>{document.errorMessage}</em>}
                        </div>
                        <div className={styles.documentStatus} data-status={document.status}>
                          <span>
                            {document.status === "ready"
                              ? "索引完成"
                              : document.status === "indexing"
                                ? "索引中"
                                : "索引失败"}
                          </span>
                          <small>{document.chunkCount} 分段</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <footer className={styles.statusBar}>
            <span className={error ? styles.errorDot : styles.okDot} />
            {error || status}
          </footer>
        </section>
      </div>
    </main>
  );
}
