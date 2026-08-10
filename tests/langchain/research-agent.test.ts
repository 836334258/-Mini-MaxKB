import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchResearchText,
  fetchTextFromUrl,
  parseAllowedResearchUrl,
  RESEARCH_SYSTEM_PROMPT,
} from "../../lib/langchain/research-agent";

test("LC1A 研究工具具有稳定名称和明确的系统规则", () => {
  assert.equal(fetchTextFromUrl.name, "fetch_text_from_url");
  assert.match(RESEARCH_SYSTEM_PROMPT, /必须先调用工具/);
  assert.match(RESEARCH_SYSTEM_PROMPT, /不要把片段当成全文/);
});

test("LC1A 只允许 Gutenberg 的 HTTPS 公共地址", () => {
  assert.equal(
    parseAllowedResearchUrl(
      "https://www.gutenberg.org/cache/epub/11/pg11.txt",
    ).hostname,
    "www.gutenberg.org",
  );

  assert.throws(() => parseAllowedResearchUrl("http://localhost:3000/secret"));
  assert.throws(() =>
    parseAllowedResearchUrl("https://user:pass@www.gutenberg.org/secret"),
  );
});

test("LC1A 把越界地址作为工具错误返回，并且不会发起请求", async () => {
  let fetchWasCalled = false;
  const fakeFetch: typeof fetch = async () => {
    fetchWasCalled = true;
    return new Response("secret");
  };

  const result = await fetchResearchText("http://127.0.0.1:3000/secret", {
    fetchImpl: fakeFetch,
  });

  assert.match(result, /^读取失败：本课只允许读取/);
  assert.equal(fetchWasCalled, false);
});

test("LC1A 返回文本时会标注来源和截断边界", async () => {
  let redirectMode: RequestRedirect | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    redirectMode = init?.redirect;
    return new Response("1234567890", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  };

  const result = await fetchResearchText(
    "https://www.gutenberg.org/example.txt",
    { fetchImpl: fakeFetch, maxChars: 5 },
  );

  assert.match(result, /来源：https:\/\/www\.gutenberg\.org\/example\.txt/);
  assert.match(result, /只返回前 5 个字符，不代表全文/);
  assert.match(result, /12345/);
  assert.doesNotMatch(result, /67890/);
  assert.equal(redirectMode, "error");
});

test("LC1A 把 HTTP 错误转换成可供模型解释的工具结果", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("Not found", {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "text/plain" },
    });

  assert.equal(
    await fetchResearchText("https://www.gutenberg.org/missing.txt", {
      fetchImpl: fakeFetch,
    }),
    "读取失败：HTTP 404 Not Found",
  );
});
