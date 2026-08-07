export const EMBEDDING_PROVIDER_IDS = ["gemini"] as const;

export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDER_IDS)[number];
export type EmbeddingPurpose = "document" | "query";

export interface EmbeddingInput {
  text: string;
  title?: string;
}

export interface EmbeddingRequest {
  inputs: EmbeddingInput[];
  purpose: EmbeddingPurpose;
}

export interface EmbeddingResponse {
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  vectors: number[][];
}

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions: number;

  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderId;
  apiKey: string;
  model: string;
  dimensions: number;
  baseUrl?: string;
}
