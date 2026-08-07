import { loadEnvConfig } from "@next/env";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { searchChunks } from "../lib/knowledge/semantic-search";
import {
  assertIndexCompatible,
  loadVectorIndex,
} from "../lib/knowledge/vector-index";

function readRequiredArgument(name: string) {
  const args = process.argv.slice(2);
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  const index = args.indexOf(name);
  const value = inline
    ? inline.slice(name.length + 1)
    : index >= 0
      ? args[index + 1]
      : undefined;

  if (!value || value.startsWith("--")) {
    throw new Error(`缺少参数 ${name}`);
  }

  return value;
}

function readOptionalArgument(name: string, fallback: string) {
  const args = process.argv.slice(2);
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  const query = readRequiredArgument("--query");
  const indexPath = readOptionalArgument(
    "--index",
    ".mini-maxkb/l1-index.json",
  );
  const topK = Number(readOptionalArgument("--top-k", "3"));
  const config = readEmbeddingProviderConfig();
  const index = await loadVectorIndex(indexPath);
  console.log('index',index)
  assertIndexCompatible(index, config);
  const provider = createEmbeddingProvider(config);
  const response = await provider.embed({
    purpose: "query",
    inputs: [{ text: query }],
  });
  const results = searchChunks(response.vectors[0], index.chunks, topK);

  console.log(`查询：${query}`);
  console.log(`命中 ${results.length} 个分段：\n`);

  results.forEach((result, indexPosition) => {
    console.log(
      `[${indexPosition + 1}] 相似度 ${result.score.toFixed(4)} | ${result.chunk.source}#${result.chunk.position}`,
    );
    console.log(`${result.chunk.content}\n`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`L1 搜索失败：${message}`);
  process.exitCode = 1;
});
