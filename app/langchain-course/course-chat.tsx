"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";

import { consumeCourseChatStream } from "../../lib/langchain/course-chat-client";
import type {
  CourseChatStreamEvent,
  CourseStreamSource,
} from "../../lib/langchain/course-chat-stream";
import type { CourseModelProvider } from "../../lib/langchain/model-config";
import styles from "./page.module.css";

interface CourseChatProps {
  defaultProvider: CourseModelProvider;
  defaultModel: string;
}

interface CourseUiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: CourseStreamSource[];
}

/** 更新指定消息；使用函数式 setState 可以安全处理连续到达的 delta。 */
function updateMessage(
  messages: CourseUiMessage[],
  id: string,
  update: (message: CourseUiMessage) => CourseUiMessage,
) {
  return messages.map((message) => (message.id === id ? update(message) : message));
}

/** 展示一次向量检索命中的课程片段。 */
function SourceCards({ sources }: { sources: CourseStreamSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className={styles.sources}>
      <div className={styles.sourcesTitle}>本次检索来源</div>
      {sources.map((source, index) => (
        <details className={styles.source} key={`${source.source}-${source.chunkIndex}`}>
          <summary>
            [{index + 1}] {source.title} · 第 {source.chunkIndex + 1} 段
          </summary>
          <p>{source.content}</p>
          <small>{source.source}</small>
        </details>
      ))}
    </div>
  );
}

/**
 * LC9 浏览器客户端：发送问题、消费 NDJSON 事件并把 delta 实时追加到消息中。
 */
export default function CourseChat({
  defaultProvider,
  defaultModel,
}: CourseChatProps) {
  const [conversationId, setConversationId] = useState<string>();
  const [provider, setProvider] = useState<CourseModelProvider>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [messages, setMessages] = useState<CourseUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("准备就绪");
  const [standaloneQuestion, setStandaloneQuestion] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const requestNumber = useRef(0);

  /** 清空浏览器视图；下一次发送时服务端会创建一个新的 SQLite 会话。 */
  function startNewConversation() {
    if (isSending) {
      return;
    }
    setConversationId(undefined);
    setMessages([]);
    setStandaloneQuestion("");
    setError("");
    setStatus("新会话尚未保存");
  }

  /** 根据 provider 带出课程默认模型，仍允许学习者手动修改。 */
  function changeProvider(nextProvider: CourseModelProvider) {
    setProvider(nextProvider);
    setModel(nextProvider === "deepseek" ? "deepseek-chat" : "gemini-3.5-flash");
  }

  /** 把每种服务端事件翻译成对应的 React 状态变化。 */
  function handleStreamEvent(
    event: CourseChatStreamEvent,
    assistantId: string,
  ) {
    if (event.type === "conversation") {
      setConversationId(event.conversation.id);
      return;
    }
    if (event.type === "status") {
      setStatus(event.message);
      return;
    }
    if (event.type === "rewrite") {
      setStandaloneQuestion(event.standaloneQuestion);
      return;
    }
    if (event.type === "sources") {
      setMessages((current) =>
        updateMessage(current, assistantId, (message) => ({
          ...message,
          sources: event.sources,
        })),
      );
      setStatus("正在接收模型输出…");
      return;
    }
    if (event.type === "delta") {
      setMessages((current) =>
        updateMessage(current, assistantId, (message) => ({
          ...message,
          content: message.content + event.content,
        })),
      );
      return;
    }
    if (event.type === "done") {
      setMessages((current) =>
        updateMessage(current, assistantId, (message) => ({
          ...message,
          content: event.message.content,
        })),
      );
      setStatus("回答已保存到 SQLite");
      return;
    }

    throw new Error(event.message);
  }

  /** 发送当前问题，并一直读取响应流直到 done 或 error。 */
  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || isSending) {
      return;
    }

    requestNumber.current += 1;
    const userId = `user-${requestNumber.current}`;
    const assistantId = `assistant-${requestNumber.current}`;

    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content: question, sources: [] },
      { id: assistantId, role: "assistant", content: "", sources: [] },
    ]);
    setInput("");
    setError("");
    setStandaloneQuestion("");
    setStatus("正在连接课程接口…");
    setIsSending(true);

    try {
      const response = await fetch("/api/langchain-course/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: question,
          provider,
          model: model.trim() || undefined,
        }),
      });

      await consumeCourseChatStream(response, (streamEvent) => {
        handleStreamEvent(streamEvent, assistantId);
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      setError(message);
      setStatus("请求失败");
      setMessages((current) =>
        updateMessage(current, assistantId, (assistantMessage) => ({
          ...assistantMessage,
          content: assistantMessage.content || "本次回答生成失败。",
        })),
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.lessonHeader}>
        <div>
          <p className={styles.eyebrow}>LANGCHAIN · LC9</p>
          <h1>浏览器流式 RAG 客户端</h1>
          <p className={styles.intro}>
            观察同一个请求如何依次经历会话创建、问题改写、向量检索和模型流式输出。
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/">返回 Mini-MaxKB</Link>
          <button disabled={isSending} onClick={startNewConversation} type="button">
            新建课程会话
          </button>
        </div>
      </section>

      <section className={styles.runtimePanel}>
        <label>
          <span>Provider</span>
          <select
            disabled={Boolean(conversationId) || isSending}
            onChange={(event) => changeProvider(event.target.value as CourseModelProvider)}
            value={provider}
          >
            <option value="google-genai">Google Gemini</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </label>
        <label>
          <span>Model</span>
          <input
            disabled={Boolean(conversationId) || isSending}
            onChange={(event) => setModel(event.target.value)}
            value={model}
          />
        </label>
        <div className={styles.runtimeState}>
          <span>会话</span>
          <code>{conversationId ?? "首条消息后创建"}</code>
        </div>
      </section>

      <section aria-live="polite" className={styles.chatPanel}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>试着问：</strong>
            <button
              onClick={() => setInput("更换 Embedding 模型后需要做什么？")}
              type="button"
            >
              更换 Embedding 模型后需要做什么？
            </button>
            <p>第一问会创建会话；第二问会携带同一个 conversationId，触发历史问题改写。</p>
          </div>
        ) : (
          <div className={styles.messages}>
            {messages.map((message) => (
              <article
                className={message.role === "user" ? styles.userMessage : styles.assistantMessage}
                key={message.id}
              >
                <div className={styles.messageRole}>
                  {message.role === "user" ? "你" : "LangChain"}
                </div>
                <div className={styles.messageContent}>
                  {message.content || <span className={styles.cursor}>正在生成</span>}
                </div>
                <SourceCards sources={message.sources} />
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.tracePanel}>
        <div>
          <span>当前状态</span>
          <strong>{status}</strong>
        </div>
        <div>
          <span>历史改写结果</span>
          <strong>{standaloneQuestion || "首轮问题无需改写"}</strong>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <form className={styles.composer} onSubmit={submitQuestion}>
        <textarea
          aria-label="课程问题"
          disabled={isSending}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="输入课程知识库问题，Enter 发送"
          rows={3}
          value={input}
        />
        <button disabled={!input.trim() || isSending} type="submit">
          {isSending ? "生成中…" : "发送"}
        </button>
      </form>
    </main>
  );
}
