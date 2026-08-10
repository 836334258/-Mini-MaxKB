import {
  CHAT_PROVIDER_IDS,
  type ChatProviderId,
} from "../../../lib/ai/types";
import type { ModelSettings } from "../../../lib/conversations/types";
import { readRetrievalConfig } from "../../../lib/rag/retrieval-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 判断环境变量中的默认供应商是否属于当前支持范围。 */
function readDefaultProvider(): ChatProviderId {
  const configured = process.env.AI_PROVIDER?.trim();
  return CHAT_PROVIDER_IDS.find((provider) => provider === configured) ?? "gemini";
}

/**
 * 只向浏览器暴露模型名称和可用状态，绝不返回 API Key 或代理配置。
 */
export function GET() {
  const retrieval = readRetrievalConfig();
  const settings: ModelSettings = {
    defaultProvider: readDefaultProvider(),
    providers: [
      {
        id: "gemini",
        model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
        available: Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
      {
        id: "deepseek",
        model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
        available: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      },
    ],
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER?.trim() || "gemini",
      model: process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-2",
    },
    retrieval: {
      strategy: "hybrid",
      ...retrieval,
    },
  };

  return Response.json({ settings });
}
