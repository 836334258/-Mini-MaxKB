import { loadEnvConfig } from "@next/env";

import { readChatProviderConfig } from "../lib/ai/config";
import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { createChatProvider } from "../lib/ai/provider-registry";
import { askKnowledgeBase } from "../lib/rag/rag-service";
import {
  assertIndexCompatible,
  loadVectorIndex,
} from "../lib/knowledge/vector-index";

interface CliOptions {
  query?: string;
  provider?: string;
  model?: string;
  indexPath: string;
  topK: number;
  help: boolean;
}

/** 读取 `--name value` 或 `--name=value` 两种形式的参数值。 */
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

/** 解析 L2 命令行参数，并在入口处完成数字参数校验。 */
function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    indexPath: ".mini-maxkb/l1-index.json",
    topK: 3,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    const matchedName = ["--query", "--provider", "--model", "--index", "--top-k"].find(
      (name) => argument === name || argument.startsWith(`${name}=`),
    );
    if (!matchedName) {
      throw new Error(`未知参数：${argument}`);
    }

    const result = readOptionValue(args, index, matchedName);
    index = result.nextIndex;

    if (matchedName === "--query") options.query = result.value;
    if (matchedName === "--provider") options.provider = result.value;
    if (matchedName === "--model") options.model = result.value;
    if (matchedName === "--index") options.indexPath = result.value;
    if (matchedName === "--top-k") options.topK = Number(result.value);
  }

  if (!options.help && !options.query?.trim()) {
    throw new Error("缺少参数 --query");
  }
  if (!Number.isInteger(options.topK) || options.topK <= 0) {
    throw new Error("--top-k 必须是正整数");
  }

  return options;
}

/** 打印 L2 的命令格式和可替换模型示例。 */
function printHelp() {
  console.log(`L2 命令行 RAG

用法：
  pnpm l2:ask -- --query "更换向量模型后要做什么"
  pnpm l2:ask -- --query "如何保护 API Key" --provider gemini --model gemini-3.5-flash

选项：
  --query       必填，要询问知识库的问题
  --provider    可选，覆盖 AI_PROVIDER
  --model       可选，覆盖当前聊天模型
  --index       可选，默认 .mini-maxkb/l1-index.json
  --top-k       可选，默认召回 3 个知识片段`);
}

/** 加载模型和索引，完成一次问答并打印答案及对应来源。 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  const options = parseOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const chatProvider = createChatProvider(
    readChatProviderConfig({
      provider: options.provider,
      model: options.model,
    }),
  );
  const embeddingConfig = readEmbeddingProviderConfig();
  const embeddingProvider = createEmbeddingProvider(embeddingConfig);
  const vectorIndex = await loadVectorIndex(options.indexPath);
  assertIndexCompatible(vectorIndex, embeddingConfig);

  console.log(
    `L2 正在问答：聊天模型 ${chatProvider.id}/${chatProvider.model}，向量模型 ${embeddingProvider.id}/${embeddingProvider.model}`,
  );

  const result = await askKnowledgeBase(
    { chatProvider, embeddingProvider, index: vectorIndex },
    {
      question: options.query!,
      topK: options.topK,
      systemPrompt: process.env.AI_SYSTEM_PROMPT,
    },
  );

  console.log(`\nAI > ${result.response.content}\n`);
  console.log("检索来源：");
  result.sources.forEach((source, index) => {
    console.log(
      `[${index + 1}] 相似度 ${source.score.toFixed(4)} | ${source.chunk.title} | ${source.chunk.source}#${source.chunk.position}`,
    );
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`L2 问答失败：${message}`);
  process.exitCode = 1;
});
