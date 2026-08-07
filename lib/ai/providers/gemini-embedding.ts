import { EmbeddingProviderError } from "../embedding-error";
import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingPurpose,
  EmbeddingRequest,
  EmbeddingResponse,
} from "../embedding-types";
import {
  getNetworkErrorMessage,
  getProviderErrorMessage,
} from "../provider-error";
import type { Fetcher } from "../types";

interface GeminiEmbeddingResponse {
  embeddings?: Array<{ values?: number[] }>;
}

interface GeminiEmbeddingProviderOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  baseUrl?: string;
  fetcher?: Fetcher;
}

function isEmbedding2(model: string) {
  return model === "gemini-embedding-2" || model.startsWith("gemini-embedding-2-");
}

function formatEmbedding2Input(
  input: EmbeddingInput,
  purpose: EmbeddingPurpose,
) {
  if (purpose === "query") {
    return `task: search result | query: ${input.text}`;
  }

  return `title: ${input.title?.trim() || "none"} | text: ${input.text}`;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  readonly dimensions: number;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(options: GeminiEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model.replace(/^models\//, "");
    this.dimensions = options.dimensions;
    this.baseUrl = (
      options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (request.inputs.length === 0) {
      throw new EmbeddingProviderError(this.id, "Embedding 输入不能为空");
    }

    const modelResource = `models/${this.model}`;
    const usesEmbedding2 = isEmbedding2(this.model);
    let response: Response;

    try {
      response = await this.fetcher(
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            requests: request.inputs.map((input) => ({
              model: modelResource,
              content: {
                parts: [
                  {
                    text: usesEmbedding2
                      ? formatEmbedding2Input(input, request.purpose)
                      : input.text,
                  },
                ],
              },
              outputDimensionality: this.dimensions,
              ...(usesEmbedding2
                ? {}
                : {
                    taskType:
                      request.purpose === "document"
                        ? "RETRIEVAL_DOCUMENT"
                        : "RETRIEVAL_QUERY",
                  }),
              ...(!usesEmbedding2 && input.title
                ? { title: input.title }
                : {}),
            })),
          }),
        },
      );
      console.dir('embedding response',response)
    } catch (error) {
      throw new EmbeddingProviderError(
        this.id,
        `网络请求失败：${getNetworkErrorMessage(error)}`,
      );
    }

    if (!response.ok) {
      throw new EmbeddingProviderError(
        this.id,
        await getProviderErrorMessage(response),
        response.status,
      );
    }

    let body: GeminiEmbeddingResponse;

    try {
      body = (await response.json()) as GeminiEmbeddingResponse;
      console.dir('embedding response body',body)
    } catch {
      throw new EmbeddingProviderError(
        this.id,
        "Gemini Embedding 返回的数据不是有效的 JSON",
        response.status,
      );
    }

    const vectors = body.embeddings?.map((embedding) => embedding.values ?? []);

    if (!vectors || vectors.length !== request.inputs.length) {
      throw new EmbeddingProviderError(
        this.id,
        `向量数量不匹配：期望 ${request.inputs.length}，实际 ${vectors?.length ?? 0}`,
      );
    }

    if (vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new EmbeddingProviderError(
        this.id,
        `向量维度不匹配：期望 ${this.dimensions}`,
      );
    }

    return {
      provider: this.id,
      model: this.model,
      dimensions: this.dimensions,
      vectors,
    };
  }
}
