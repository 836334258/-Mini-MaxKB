import type { ChatProviderId, ChatRole } from "../ai/types";

export interface MessageSource {
  id: string;
  source: string;
  title: string;
  position: number;
  score: number;
  semanticScore?: number;
  keywordScore?: number;
  content: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: Exclude<ChatRole, "system">;
  content: string;
  sources: MessageSource[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  provider: ChatProviderId;
  model: string;
  knowledgeBaseId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: StoredMessage[];
}

export interface ModelSettings {
  defaultProvider: ChatProviderId;
  providers: Array<{
    id: ChatProviderId;
    model: string;
    available: boolean;
  }>;
  embedding: {
    provider: string;
    model: string;
  };
  retrieval: {
    strategy: "hybrid";
    topK: number;
    candidateK: number;
    minScore: number;
    semanticWeight: number;
  };
}
