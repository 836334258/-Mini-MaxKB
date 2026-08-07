import type { EmbeddingProviderId } from "./embedding-types";

export class EmbeddingProviderError extends Error {
  constructor(
    public readonly provider: EmbeddingProviderId,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}
