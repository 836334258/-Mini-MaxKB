import {
  ChatProviderError,
  getNetworkErrorMessage,
  getProviderErrorMessage,
} from "../provider-error";
import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  Fetcher,
} from "../types";

interface GeminiResponse {
  modelVersion?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: {
    blockReason?: string;
  };
}

interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
}

export class GeminiChatProvider implements ChatProvider {
  readonly id = "gemini" as const;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model.replace(/^models\//, "");
    this.baseUrl = (
      options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const systemInstruction = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const generationConfig = {
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: request.maxOutputTokens }),
    };
    let response: Response;

    try {
      response = await this.fetcher(
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            contents: toGeminiContents(request.messages),
            ...(systemInstruction
              ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
              : {}),
            ...(Object.keys(generationConfig).length > 0
              ? { generationConfig }
              : {}),
          }),
        },
      );
    } catch (error) {
      throw new ChatProviderError(
        this.id,
        `网络请求失败：${getNetworkErrorMessage(error)}`,
      );
    }

    if (!response.ok) {
      throw new ChatProviderError(
        this.id,
        await getProviderErrorMessage(response),
        response.status,
      );
    }

    let body: GeminiResponse;

    try {
      body = (await response.json()) as GeminiResponse;
      console.log('body',body)
    } catch {
      throw new ChatProviderError(
        this.id,
        "Gemini 返回的数据不是有效的 JSON",
        response.status,
      );
    }
    const candidate = body.candidates?.[0];
    const content = candidate?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!content) {
      const detail = body.promptFeedback?.blockReason
        ? `，原因：${body.promptFeedback.blockReason}`
        : "";
      throw new ChatProviderError(this.id, `Gemini 返回了空内容${detail}`);
    }

    return {
      provider: this.id,
      model: body.modelVersion ?? this.model,
      content,
      finishReason: candidate?.finishReason,
      usage: body.usageMetadata
        ? {
            inputTokens: body.usageMetadata.promptTokenCount,
            outputTokens: body.usageMetadata.candidatesTokenCount,
            totalTokens: body.usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }
}
