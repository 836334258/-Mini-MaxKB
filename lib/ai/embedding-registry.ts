import type { Fetcher } from "./types";
import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingProviderId,
} from "./embedding-types";
import { GeminiEmbeddingProvider } from "./providers/gemini-embedding";

type EmbeddingProviderFactory = (
  config: EmbeddingProviderConfig,
  fetcher?: Fetcher,
) => EmbeddingProvider;

const providerFactories: Record<
  EmbeddingProviderId,
  EmbeddingProviderFactory
> = {
  gemini: (config, fetcher) =>
    new GeminiEmbeddingProvider({ ...config, fetcher }),
};

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
  fetcher?: Fetcher,
) {
  return providerFactories[config.provider](config, fetcher);
}
