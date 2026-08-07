"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ChatProviderId } from "../lib/ai/types";
import type { ChatStreamEvent } from "../lib/chat-stream/types";
import type {
  ConversationDetail,
  ConversationSummary,
  MessageSource,
  ModelSettings,
  StoredMessage,
} from "../lib/conversations/types";
import styles from "./page.module.css";

/** 请求 JSON 接口并把服务端错误转换成可展示的异常。 */
async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `请求失败：HTTP ${response.status}`);
  }
  return body;
}

/** 逐行读取 NDJSON 响应，使页面能随着服务端事件持续更新。 */
async function consumeChatStream(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
) {
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error || `问答失败：HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("浏览器没有收到流式响应体");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        onEvent(JSON.parse(line) as ChatStreamEvent);
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

/** 将 ISO 时间转换成简短的本地时间。 */
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** 展示一条来源引用及其相似度。 */
function SourceList({ sources }: { sources: MessageSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className={styles.sources}>
      <div className={styles.sourcesTitle}>检索来源</div>
      {sources.map((source, index) => (
        <details className={styles.source} key={`${source.id}-${index}`}>
          <summary>
            <span>[{index + 1}] {source.title}</span>
            <span>{source.score.toFixed(4)}</span>
          </summary>
          <p>{source.content}</p>
          <small>{source.source}#{source.position}</small>
        </details>
      ))}
    </div>
  );
}

export default function Home() {
  const [settings, setSettings] = useState<ModelSettings>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [provider, setProvider] = useState<ChatProviderId>("gemini");
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("准备就绪");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingSources, setStreamingSources] = useState<MessageSource[]>([]);
  const messageEndRef = useRef<HTMLDivElement>(null);

  /** 刷新左侧会话列表，并保持服务端的最近活动排序。 */
  async function refreshConversations() {
    const result = await requestJson<{ conversations: ConversationSummary[] }>(
      "/api/conversations",
    );
    setConversations(result.conversations);
    return result.conversations;
  }

  /** 加载一个会话的完整消息，并同步其固定模型。 */
  async function loadConversation(id: string) {
    const result = await requestJson<{ conversation: ConversationDetail }>(
      `/api/conversations/${encodeURIComponent(id)}`,
    );
    setActiveId(result.conversation.id);
    setMessages(result.conversation.messages);
    setProvider(result.conversation.provider);
    setModel(result.conversation.model);
    setError("");
  }

  useEffect(() => {
    async function initialize() {
      try {
        const [{ settings: loadedSettings }, conversationList] = await Promise.all([
          requestJson<{ settings: ModelSettings }>("/api/settings"),
          refreshConversations(),
        ]);
        setSettings(loadedSettings);
        setProvider(loadedSettings.defaultProvider);
        setModel(
          loadedSettings.providers.find(
            (item) => item.id === loadedSettings.defaultProvider,
          )?.model ?? "",
        );

        if (conversationList[0]) {
          await loadConversation(conversationList[0].id);
        }
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

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingAnswer, status]);

  /** 清空当前视图，新会话会在发送第一条问题时写入数据库。 */
  function startNewConversation() {
    const defaultProvider = settings?.defaultProvider ?? "gemini";
    setActiveId(undefined);
    setMessages([]);
    setProvider(defaultProvider);
    setModel(
      settings?.providers.find((item) => item.id === defaultProvider)?.model ?? "",
    );
    setInput("");
    setError("");
    setStatus("新会话尚未保存");
    setStreamingAnswer("");
    setStreamingSources([]);
  }

  /** 切换供应商时自动带出服务端配置的默认模型名称。 */
  function changeProvider(nextProvider: ChatProviderId) {
    setProvider(nextProvider);
    setModel(
      settings?.providers.find((item) => item.id === nextProvider)?.model ?? "",
    );
  }

  /** 发送问题、消费流事件，并在完成后用数据库数据校准页面状态。 */
  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || isSending) {
      return;
    }

    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage: StoredMessage = {
      id: optimisticId,
      conversationId: activeId ?? "",
      role: "user",
      content: question,
      sources: [],
      createdAt: new Date().toISOString(),
    };
    let conversationId = activeId;
    let streamError = "";

    setMessages((current) => [...current, optimisticMessage]);
    setInput("");
    setError("");
    setIsSending(true);
    setStreamingAnswer("");
    setStreamingSources([]);
    setStatus("正在连接知识库…");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: question,
          provider,
          model: model.trim() || undefined,
        }),
      });

      await consumeChatStream(response, (streamEvent) => {
        if (streamEvent.type === "conversation") {
          conversationId = streamEvent.conversation.id;
          setActiveId(conversationId);
        }
        if (streamEvent.type === "status") {
          setStatus(streamEvent.message);
        }
        if (streamEvent.type === "sources") {
          setStreamingSources(streamEvent.sources);
          setStatus("正在接收答案…");
        }
        if (streamEvent.type === "delta") {
          setStreamingAnswer((current) => current + streamEvent.content);
        }
        if (streamEvent.type === "done") {
          setMessages((current) => [...current, streamEvent.message]);
          setStatus("回答已保存");
        }
        if (streamEvent.type === "error") {
          streamError = streamEvent.message;
        }
      });

      if (streamError) {
        throw new Error(streamError);
      }
      if (conversationId) {
        await loadConversation(conversationId);
      }
      await refreshConversations();
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      setError(message);
      setStatus("问答失败");

      if (conversationId) {
        await loadConversation(conversationId).catch(() => undefined);
        await refreshConversations().catch(() => undefined);
      } else {
        setMessages((current) =>
          current.filter((messageItem) => messageItem.id !== optimisticId),
        );
      }
    } finally {
      setIsSending(false);
      setStreamingAnswer("");
      setStreamingSources([]);
    }
  }

  const selectedProvider = settings?.providers.find(
    (item) => item.id === provider,
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>M</div>
          <div>
            <strong>Mini-MaxKB</strong>
            <span>L3 · Web 知识库</span>
          </div>
        </div>

        <button className={styles.newButton} onClick={startNewConversation}>
          <span>＋</span> 新建对话
        </button>

        <div className={styles.historyLabel}>历史会话</div>
        <nav className={styles.history} aria-label="历史会话">
          {conversations.length === 0 ? (
            <p className={styles.emptyHistory}>第一条消息发送后，会话会保存在 SQLite。</p>
          ) : (
            conversations.map((conversation) => (
              <button
                className={`${styles.historyItem} ${
                  conversation.id === activeId ? styles.historyItemActive : ""
                }`}
                key={conversation.id}
                onClick={() => void loadConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>{conversation.provider} · {formatTime(conversation.updatedAt)}</span>
              </button>
            ))
          )}
        </nav>

        <div className={styles.sidebarFoot}>
          <span className={styles.onlineDot} />
          SQLite 本地持久化
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>KNOWLEDGE CHAT</p>
            <h1>{activeId ? "知识库问答" : "开始新的知识问答"}</h1>
          </div>

          <div className={styles.modelControls}>
            <label>
              <span>聊天供应商</span>
              <select
                disabled={Boolean(activeId) || isSending}
                value={provider}
                onChange={(event) => changeProvider(event.target.value as ChatProviderId)}
              >
                {settings?.providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}{item.available ? "" : "（未配置）"}
                  </option>
                )) ?? <option value="gemini">gemini</option>}
              </select>
            </label>
            <label>
              <span>模型</span>
              <input
                disabled={Boolean(activeId) || isSending}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="模型名称"
              />
            </label>
          </div>
        </header>

        <section className={styles.chat} aria-live="polite">
          {messages.length === 0 && !streamingAnswer ? (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}>KB</div>
              <h2>向你的知识库提问</h2>
              <p>
                系统会先检索本地文档，再让 {provider} 基于命中内容回答，并保留可追溯的来源。
              </p>
              <div className={styles.flow}>
                <span>问题向量化</span><b>→</b><span>Top K 检索</span><b>→</b><span>模型回答</span>
              </div>
            </div>
          ) : (
            <div className={styles.messages}>
              {messages.map((message) => (
                <article
                  className={`${styles.message} ${
                    message.role === "user" ? styles.userMessage : styles.assistantMessage
                  }`}
                  key={message.id}
                >
                  <div className={styles.avatar}>{message.role === "user" ? "你" : "M"}</div>
                  <div className={styles.messageBody}>
                    <div className={styles.messageMeta}>
                      <strong>{message.role === "user" ? "你" : "Mini-MaxKB"}</strong>
                      <span>{formatTime(message.createdAt)}</span>
                    </div>
                    <div className={styles.messageContent}>{message.content}</div>
                    <SourceList sources={message.sources} />
                  </div>
                </article>
              ))}

              {(isSending || streamingAnswer) && (
                <article className={`${styles.message} ${styles.assistantMessage}`}>
                  <div className={styles.avatar}>M</div>
                  <div className={styles.messageBody}>
                    <div className={styles.messageMeta}>
                      <strong>Mini-MaxKB</strong>
                      <span className={styles.streaming}>流式响应</span>
                    </div>
                    <div className={styles.messageContent}>
                      {streamingAnswer || <span className={styles.thinking}>正在思考</span>}
                    </div>
                    <SourceList sources={streamingSources} />
                  </div>
                </article>
              )}
              <div ref={messageEndRef} />
            </div>
          )}
        </section>

        <footer className={styles.composerArea}>
          {error && <div className={styles.error}>{error}</div>}
          <form className={styles.composer} onSubmit={submitQuestion}>
            <textarea
              aria-label="知识库问题"
              disabled={isSending || selectedProvider?.available === false}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                selectedProvider?.available === false
                  ? `请先在 .env.local 配置 ${provider} API Key`
                  : "输入问题，Enter 发送，Shift + Enter 换行"
              }
              rows={3}
              value={input}
            />
            <button disabled={!input.trim() || isSending} type="submit">
              {isSending ? "生成中" : "发送"}
            </button>
          </form>
          <div className={styles.composerMeta}>
            <span>{status}</span>
            <span>
              Embedding：{settings?.embedding.provider ?? "-"} / {settings?.embedding.model ?? "-"}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
