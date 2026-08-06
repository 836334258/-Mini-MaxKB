export const CHAT_PROVIDER_IDS = ["deepseek", "gemini"] as const;

export type ChatProviderId = (typeof CHAT_PROVIDER_IDS)[number];

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatResponse {
  provider: ChatProviderId;
  model: string;
  content: string;
  finishReason?: string;
  usage?: TokenUsage;
}

export interface ChatProvider {
  readonly id: ChatProviderId;
  readonly model: string;

  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface ChatProviderConfig {
  provider: ChatProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type Fetcher = typeof fetch;
