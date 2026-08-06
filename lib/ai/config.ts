import {
  CHAT_PROVIDER_IDS,
  type ChatProviderConfig,
  type ChatProviderId,
} from "./types";

interface ConfigOverrides {
  provider?: string;
  model?: string;
}

function isChatProviderId(value: string): value is ChatProviderId {
  return CHAT_PROVIDER_IDS.some((provider) => provider === value);
}

function requireValue(name: string, value: string | undefined) {
  if (!value?.trim()) {
    throw new Error(`缺少配置 ${name}，请在 .env.local 中填写`);
  }

  return value.trim();
}

export function readChatProviderConfig(
  overrides: ConfigOverrides = {},
): ChatProviderConfig {
  const rawProvider = (overrides.provider ?? process.env.AI_PROVIDER ?? "").trim();

  if (!isChatProviderId(rawProvider)) {
    throw new Error(
      `AI_PROVIDER 必须是以下值之一：${CHAT_PROVIDER_IDS.join(", ")}`,
    );
  }

  if (rawProvider === "deepseek") {
    return {
      provider: rawProvider,
      apiKey: requireValue("DEEPSEEK_API_KEY", process.env.DEEPSEEK_API_KEY),
      model: requireValue(
        "DEEPSEEK_MODEL",
        overrides.model ?? process.env.DEEPSEEK_MODEL,
      ),
      baseUrl: process.env.DEEPSEEK_API_BASE_URL?.trim() || undefined,
    };
  }

  return {
    provider: rawProvider,
    apiKey: requireValue("GEMINI_API_KEY", process.env.GEMINI_API_KEY),
    model: requireValue(
      "GEMINI_MODEL",
      overrides.model ?? process.env.GEMINI_MODEL,
    ),
    baseUrl: process.env.GEMINI_API_BASE_URL?.trim() || undefined,
  };
}
