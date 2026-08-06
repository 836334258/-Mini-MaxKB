import assert from "node:assert/strict";
import test from "node:test";

import { readChatProviderConfig } from "../../lib/ai/config";
import { ChatProviderError } from "../../lib/ai/provider-error";
import { DeepSeekChatProvider } from "../../lib/ai/providers/deepseek";
import { GeminiChatProvider } from "../../lib/ai/providers/gemini";
import type { Fetcher } from "../../lib/ai/types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("DeepSeek 适配器转换统一消息并归一化响应", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetcher: Fetcher = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse({
      model: "deepseek-test",
      choices: [
        {
          finish_reason: "stop",
          message: { content: " 你好！ " },
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      },
    });
  };
  const provider = new DeepSeekChatProvider({
    apiKey: "secret",
    model: "deepseek-test",
    fetcher,
  });

  const result = await provider.chat({
    messages: [{ role: "user", content: "你好" }],
    temperature: 0.2,
    maxOutputTokens: 128,
  });

  assert.equal(capturedUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(
    (capturedInit?.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    model: "deepseek-test",
    messages: [{ role: "user", content: "你好" }],
    stream: false,
    temperature: 0.2,
    max_tokens: 128,
  });
  assert.deepEqual(result, {
    provider: "deepseek",
    model: "deepseek-test",
    content: "你好！",
    finishReason: "stop",
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  });
});

test("Gemini 适配器分离系统指令并转换 assistant 角色", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetcher: Fetcher = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse({
      modelVersion: "gemini-test-001",
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "你好" }, { text: "，世界！" }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 3,
        totalTokenCount: 7,
      },
    });
  };
  const provider = new GeminiChatProvider({
    apiKey: "secret",
    model: "models/gemini-test",
    fetcher,
  });

  const result = await provider.chat({
    messages: [
      { role: "system", content: "你是助手" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好呀" },
      { role: "user", content: "继续" },
    ],
  });

  assert.equal(
    capturedUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
  );
  assert.equal(
    (capturedInit?.headers as Record<string, string>)["x-goog-api-key"],
    "secret",
  );
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    contents: [
      { role: "user", parts: [{ text: "你好" }] },
      { role: "model", parts: [{ text: "你好呀" }] },
      { role: "user", parts: [{ text: "继续" }] },
    ],
    systemInstruction: { parts: [{ text: "你是助手" }] },
  });
  assert.deepEqual(result, {
    provider: "gemini",
    model: "gemini-test-001",
    content: "你好，世界！",
    finishReason: "STOP",
    usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
  });
});

test("供应商错误被转换成统一错误", async () => {
  const provider = new DeepSeekChatProvider({
    apiKey: "bad-key",
    model: "deepseek-test",
    fetcher: async () =>
      jsonResponse({ error: { message: "Authentication failed" } }, 401),
  });

  await assert.rejects(
    provider.chat({ messages: [{ role: "user", content: "你好" }] }),
    (error: unknown) => {
      assert.ok(error instanceof ChatProviderError);
      assert.equal(error.provider, "deepseek");
      assert.equal(error.status, 401);
      assert.equal(error.message, "Authentication failed");
      return true;
    },
  );
});

test("网络错误被转换成统一错误且不会泄露密钥", async () => {
  const provider = new GeminiChatProvider({
    apiKey: "do-not-leak",
    model: "gemini-test",
    fetcher: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    provider.chat({ messages: [{ role: "user", content: "你好" }] }),
    (error: unknown) => {
      assert.ok(error instanceof ChatProviderError);
      assert.equal(error.provider, "gemini");
      assert.match(error.message, /网络请求失败：fetch failed/);
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    },
  );
});

test("环境配置可以切换供应商和覆盖模型", () => {
  const original = { ...process.env };

  try {
    process.env.AI_PROVIDER = "deepseek";
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GEMINI_MODEL = "gemini-from-env";

    assert.deepEqual(
      readChatProviderConfig({ provider: "gemini", model: "gemini-override" }),
      {
        provider: "gemini",
        apiKey: "gemini-key",
        model: "gemini-override",
        baseUrl: undefined,
      },
    );
  } finally {
    process.env = original;
  }
});
