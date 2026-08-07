import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { readChatProviderConfig } from "../lib/ai/config";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { ChatProviderError } from "../lib/ai/provider-error";
import { createChatProvider } from "../lib/ai/provider-registry";
import type { ChatMessage } from "../lib/ai/types";

interface CliOptions {
  provider?: string;
  model?: string;
  help: boolean;
}

function readOptionValue(args: string[], index: number, name: string) {
  const argument = args[index];
  const inlineValue = argument.split("=", 2)[1];

  if (inlineValue) {
    return { value: inlineValue, nextIndex: index };
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} 需要一个值`);
  }

  return { value, nextIndex: index + 1 };
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = { help: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--provider" || argument.startsWith("--provider=")) {
      const result = readOptionValue(args, index, "--provider");
      options.provider = result.value;
      index = result.nextIndex;
      continue;
    }

    if (argument === "--model" || argument.startsWith("--model=")) {
      const result = readOptionValue(args, index, "--model");
      options.model = result.value;
      index = result.nextIndex;
      continue;
    }

    throw new Error(`未知参数：${argument}`);
  }

  return options;
}

function printHelp() {
  console.log(`L0 多模型命令行对话

用法：
  pnpm chat:l0
  pnpm chat:l0 -- --provider deepseek --model deepseek-v4-flash
  pnpm chat:l0 -- --provider gemini --model gemini-3.5-flash

会话命令：
  /clear  清空上下文
  /exit   退出`);
}

async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  const options = parseOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = readChatProviderConfig(options);
  const provider = createChatProvider(config);
  const systemPrompt = process.env.AI_SYSTEM_PROMPT?.trim();
  let history: ChatMessage[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }]
    : [];
  const terminal = createInterface({ input: stdin, output: stdout });

  console.log(`L0 已启动：${provider.id} / ${provider.model}`);
  console.log("输入 /clear 清空上下文，输入 /exit 退出。\n");

  try {
    while (true) {
      const input = (await terminal.question("你 > ")).trim();

      if (!input) {
        continue;
      }

      if (input === "/exit") {
        break;
      }

      if (input === "/clear") {
        history = systemPrompt
          ? [{ role: "system", content: systemPrompt }]
          : [];
        console.log("上下文已清空。\n");
        continue;
      }

      const userMessage: ChatMessage = { role: "user", content: input };

      try {
        const response = await provider.chat({
          messages: [...history, userMessage],
        });
        history.push(userMessage, {
          role: "assistant",
          content: response.content,
        });
        console.log(`\nAI > ${response.content}\n`);
      } catch (error) {
        if (error instanceof ChatProviderError) {
          const status = error.status ? ` (HTTP ${error.status})` : "";
          console.error(`\n${error.provider} 调用失败${status}：${error.message}\n`);
          continue;
        }

        throw error;
      }
    }
  } finally {
    terminal.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`启动失败：${message}`);
  process.exitCode = 1;
});
