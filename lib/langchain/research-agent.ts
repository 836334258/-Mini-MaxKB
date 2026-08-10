import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent } from "langchain";
import { z } from "zod";

import { DEFAULT_QUICKSTART_MODEL } from "./quickstart-agent";

export const RESEARCH_SYSTEM_PROMPT = `你是一名谨慎的文本研究助手。

## 可用能力

- \`fetch_text_from_url\`：读取允许列表中的公开文本网址。

## 行为规则

1. 只要问题依赖网址内容，必须先调用工具，不能依靠记忆猜测。
2. 回答必须以工具返回的文本为依据。
3. 工具可能只返回开头片段；如果证据不足，明确说明不知道，不要把片段当成全文。
4. 如果工具返回错误，直接解释错误，不要编造结果。`;

export const MAX_RESEARCH_TEXT_CHARS = 20_000;
export const RESEARCH_FETCH_TIMEOUT_MS = 20_000;

const ALLOWED_RESEARCH_HOSTS = new Set([
  "gutenberg.org",
  "www.gutenberg.org",
]);

type FetchTextOptions = {
  fetchImpl?: typeof fetch;
  maxChars?: number;
  timeoutMs?: number;
};

/**
 * 校验研究工具的 URL 边界。
 *
 * 教材只开放 Project Gutenberg 的 HTTPS 文本，避免 Agent 被诱导访问
 * 本机、局域网、云服务元数据地址或带凭据的 URL。
 */
export function parseAllowedResearchUrl(rawUrl: string) {
  const url = new URL(rawUrl);

  if (
    url.protocol !== "https:" ||
    !ALLOWED_RESEARCH_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      "本课只允许读取 https://www.gutenberg.org 上的公开文本",
    );
  }

  return url;
}

/**
 * 从受控 URL 读取文本，并限制等待时间和返回长度。
 *
 * fetchImpl 参数用于离线测试；生产调用不传时使用 Node.js 自带的 fetch。
 */
export async function fetchResearchText(
  rawUrl: string,
  options: FetchTextOptions = {},
) {
  let url: URL;
  try {
    url = parseAllowedResearchUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `读取失败：${message}`;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxChars = options.maxChars ?? MAX_RESEARCH_TEXT_CHARS;
  const timeoutMs = options.timeoutMs ?? RESEARCH_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "mini-maxkb-langchain-course/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      return `读取失败：HTTP ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !contentType.includes("text/plain") &&
      !contentType.includes("text/html")
    ) {
      return `读取失败：不支持的内容类型 ${contentType}`;
    }

    const text = await response.text();
    const truncated = text.length > maxChars;
    const visibleText = text.slice(0, maxChars);

    return [
      `来源：${url.toString()}`,
      `范围：${truncated ? `只返回前 ${maxChars} 个字符，不代表全文` : "已返回完整文本"}`,
      "--- 文本开始 ---",
      visibleText,
      "--- 文本结束 ---",
    ].join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `读取失败：${message}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 供 Agent 调用的外部文本工具；Zod 会在函数执行前校验 URL 格式。 */
export const fetchTextFromUrl = tool(
  async ({ url }) => fetchResearchText(url),
  {
    name: "fetch_text_from_url",
    description:
      "读取 Project Gutenberg 上的公开文本；结果可能因长度限制而截断",
    schema: z.object({
      url: z.url().describe("Project Gutenberg 的 HTTPS 文本网址"),
    }),
  },
);

/** 创建研究 Agent；既接受模型字符串，也接受 LC1B 初始化后的模型对象。 */
export function createResearchAgent(
  model: string | BaseChatModel = DEFAULT_QUICKSTART_MODEL,
) {
  return createAgent({
    model,
    tools: [fetchTextFromUrl],
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
  });
}
