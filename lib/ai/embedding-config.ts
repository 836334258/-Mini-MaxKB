import {
  EMBEDDING_PROVIDER_IDS,
  type EmbeddingProviderConfig,
  type EmbeddingProviderId,
} from "./embedding-types";

function isEmbeddingProviderId(value: string): value is EmbeddingProviderId {
  return EMBEDDING_PROVIDER_IDS.some((provider) => provider === value);
}

function requireValue(name: string, value: string | undefined) {
  if (!value?.trim()) {
    throw new Error(`缺少配置 ${name}，请在 .env.local 中填写`);
  }

  return value.trim();
}

function readDimensions(value: string | undefined) {
  const dimensions = Number(value ?? "768");

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("EMBEDDING_DIMENSIONS 必须是正整数");
  }

  return dimensions;
}

export function readEmbeddingProviderConfig(): EmbeddingProviderConfig {
  const provider = (process.env.EMBEDDING_PROVIDER ?? "gemini").trim();

  if (!isEmbeddingProviderId(provider)) {
    throw new Error(
      `EMBEDDING_PROVIDER 必须是以下值之一：${EMBEDDING_PROVIDER_IDS.join(", ")}`,
    );
  }

  return {
    provider,
    apiKey: requireValue("GEMINI_API_KEY", process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-2",
    dimensions: readDimensions(process.env.EMBEDDING_DIMENSIONS),
    baseUrl: process.env.GEMINI_API_BASE_URL?.trim() || undefined,
  };
}
