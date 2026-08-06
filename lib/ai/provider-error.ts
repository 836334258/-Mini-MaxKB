import type { ChatProviderId } from "./types";

export class ChatProviderError extends Error {
  constructor(
    public readonly provider: ChatProviderId,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ChatProviderError";
  }
}

export async function getProviderErrorMessage(response: Response) {
  const fallback = `HTTP ${response.status} ${response.statusText}`.trim();

  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };

    if (typeof body.error === "string") {
      return body.error;
    }

    return body.error?.message ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function getNetworkErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
