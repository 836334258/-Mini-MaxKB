import { loadEnvConfig } from "@next/env";

import { readChatProviderConfig } from "../lib/ai/config";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { createChatProvider } from "../lib/ai/provider-registry";
import type { ChatMessage } from "../lib/ai/types";

function readProviderOverride(args: string[]) {
  const inline = args.find((argument) => argument.startsWith("--provider="));
  if (inline) {
    return inline.slice("--provider=".length);
  }

  const index = args.indexOf("--provider");
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  const providerOverride = readProviderOverride(process.argv.slice(2));
  const config = readChatProviderConfig({ provider: providerOverride });
  const provider = createChatProvider(config);
  const history: ChatMessage[] = [
    {
      role: "user",
      content: "请记住数字 37，只回复“收到”。",
    },
  ];

  console.log(`正在验收：${provider.id} / ${provider.model}`);
  const first = await provider.chat({ messages: history });
  history.push({ role: "assistant", content: first.content });
  history.push({
    role: "user",
    content: "我让你记住的数字是什么？只回复数字。",
  });
  const second = await provider.chat({ messages: history });

  console.log(`第一轮：${first.content}`);
  console.log(`第二轮：${second.content}`);

  if (!/(^|\D)37(\D|$)/.test(second.content)) {
    throw new Error("上下文验收失败：第二轮回答中没有数字 37");
  }

  console.log("L0 真实调用和两轮上下文验收通过。");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`L0 验收失败：${message}`);
  process.exitCode = 1;
});
