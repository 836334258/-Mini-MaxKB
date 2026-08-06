import {
  ChatProviderError,
  getNetworkErrorMessage,
  getProviderErrorMessage,
} from "../provider-error";
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  Fetcher,
} from "../types";

interface DeepSeekResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface DeepSeekProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetcher?: Fetcher;
}

export class DeepSeekChatProvider implements ChatProvider {
  readonly id = "deepseek" as const;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(options: DeepSeekProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(
      /\/$/,
      "",
    );
    this.fetcher = options.fetcher ?? fetch;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    let response: Response;

    try {
      response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: false,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined
            ? {}
            : { max_tokens: request.maxOutputTokens }),
        }),
      });
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

    let body: DeepSeekResponse;

    try {
      body = (await response.json()) as DeepSeekResponse;
    } catch {
      throw new ChatProviderError(
        this.id,
        "DeepSeek 返回的数据不是有效的 JSON",
        response.status,
      );
    }
    const choice = body.choices?.[0];
    console.log('body',body)
    const content = choice?.message?.content?.trim();

    if (!content) {
      throw new ChatProviderError(this.id, "DeepSeek 返回了空内容");
    }

    return {
      provider: this.id,
      model: body.model ?? this.model,
      content,
      finishReason: choice?.finish_reason ?? undefined,
      usage: body.usage
        ? {
            inputTokens: body.usage.prompt_tokens,
            outputTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens,
          }
        : undefined,
    };
  }
}
