export type KnowledgeDocumentStatus = "indexing" | "ready" | "error";

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: KnowledgeDocumentStatus;
  chunkCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  description: string;
  isBuiltin: boolean;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseDetail extends KnowledgeBaseSummary {
  documents: KnowledgeDocument[];
}
