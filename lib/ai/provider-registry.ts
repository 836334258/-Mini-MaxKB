import { DeepSeekChatProvider } from "./providers/deepseek";
import { GeminiChatProvider } from "./providers/gemini";
import type {
  ChatProvider,
  ChatProviderConfig,
  ChatProviderId,
  Fetcher,
} from "./types";

type ProviderFactory = (
  config: ChatProviderConfig,
  fetcher?: Fetcher,
) => ChatProvider;

const providerFactories: Record<ChatProviderId, ProviderFactory> = {
  deepseek: (config, fetcher) =>
    new DeepSeekChatProvider({ ...config, fetcher }),
  gemini: (config, fetcher) =>
    new GeminiChatProvider({ ...config, fetcher }),
};

export function createChatProvider(
  config: ChatProviderConfig,
  fetcher?: Fetcher,
) {
  return providerFactories[config.provider](config, fetcher);
}
