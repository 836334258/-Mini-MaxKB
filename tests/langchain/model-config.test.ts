import assert from "node:assert/strict";
import test from "node:test";

import {
  configureCourseModelAuthentication,
  createInitChatModelOptions,
  readCourseModelConfig,
} from "../../lib/langchain/model-config";

test("LC1B 默认创建稳定、低随机性的 Gemini 配置", () => {
  const config = readCourseModelConfig({});

  assert.deepEqual(config, {
    modelProvider: "google-genai",
    model: "gemini-3.5-flash",
    temperature: 0.2,
    timeoutMs: 120_000,
    maxTokens: 2_048,
    maxRetries: 2,
  });
});

test("LC1B 可以只通过环境变量切换到 DeepSeek", () => {
  const config = readCourseModelConfig({
    LANGCHAIN_MODEL_PROVIDER: "deepseek",
    LANGCHAIN_MODEL: "deepseek-chat",
    LANGCHAIN_TEMPERATURE: "0",
    LANGCHAIN_TIMEOUT_MS: "90000",
    LANGCHAIN_MAX_TOKENS: "4096",
    LANGCHAIN_MAX_RETRIES: "4",
  });

  assert.deepEqual(config, {
    modelProvider: "deepseek",
    model: "deepseek-chat",
    temperature: 0,
    timeoutMs: 90_000,
    maxTokens: 4_096,
    maxRetries: 4,
  });
});

test("LC1B 拒绝无效 provider 和越界模型参数", () => {
  assert.throws(() =>
    readCourseModelConfig({ LANGCHAIN_MODEL_PROVIDER: "unknown" }),
  );
  assert.throws(() =>
    readCourseModelConfig({ LANGCHAIN_TEMPERATURE: "3" }),
  );
  assert.throws(() =>
    readCourseModelConfig({ LANGCHAIN_MAX_RETRIES: "not-a-number" }),
  );
});

test("LC1B 把课程配置准确映射给 initChatModel", () => {
  const config = readCourseModelConfig({});

  assert.deepEqual(createInitChatModelOptions(config), {
    modelProvider: "google-genai",
    temperature: 0.2,
    timeout: 120_000,
    maxTokens: 2_048,
    maxRetries: 2,
  });
});

test("LC1B 认证检查不会把 API Key 放进模型配置", () => {
  const environment: Record<string, string | undefined> = {
    GEMINI_API_KEY: "local-test-key",
  };
  const config = readCourseModelConfig(environment);

  configureCourseModelAuthentication(config, environment);

  assert.equal(environment.GOOGLE_API_KEY, "local-test-key");
  assert.equal("apiKey" in config, false);
  assert.throws(() =>
    configureCourseModelAuthentication(
      readCourseModelConfig({ LANGCHAIN_MODEL_PROVIDER: "deepseek" }),
      {},
    ),
  );
});
