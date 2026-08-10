import path from "node:path";

import { loadAndSplitTextDocument } from "../lib/langchain/document-processing";

const DEFAULT_INPUT = "data/l1-documents/learning-path.md";

/** 读取 `--name value` 或 `--name=value` 两种命令行参数格式。 */
function readArgument(name: string, fallback: string) {
  const argumentsList = process.argv.slice(2);
  const inlineArgument = argumentsList.find((argument) =>
    argument.startsWith(`${name}=`),
  );

  if (inlineArgument) {
    return inlineArgument.slice(name.length + 1);
  }

  const argumentIndex = argumentsList.indexOf(name);
  return argumentIndex >= 0
    ? (argumentsList[argumentIndex + 1] ?? fallback)
    : fallback;
}

/** 读取切块整数参数，并在进入业务函数前给出易懂的报错。 */
function readIntegerArgument(name: string, fallback: number) {
  const value = Number(readArgument(name, String(fallback)));

  if (!Number.isInteger(value)) {
    throw new Error(`${name} 必须是整数`);
  }

  return value;
}

/**
 * 运行 LC2：完整打印原始 Document，再逐块打印切分后的 Document。
 * 本课不创建 Embedding，也不调用聊天模型，因此不会消耗模型额度。
 */
async function main() {
  const input = readArgument("--input", DEFAULT_INPUT);
  const chunkSize = readIntegerArgument("--chunk-size", 80);
  const chunkOverlap = readIntegerArgument("--overlap", 15);
  const { document, chunks } = await loadAndSplitTextDocument(input, {
    chunkSize,
    chunkOverlap,
  });

  console.log("LC2 原始 LangChain Document（完整对象）：");
  console.dir(document, { depth: null, colors: true });
  console.log(
    `\n切块配置：chunkSize=${chunkSize}，chunkOverlap=${chunkOverlap}`,
  );
  console.log(`输入文件：${path.resolve(input)}`);
  console.log(`共生成 ${chunks.length} 个 chunks。`);

  for (const chunk of chunks) {
    console.log(`\n--- chunk ${chunk.metadata.chunkIndex + 1}/${chunks.length} ---`);
    console.dir(chunk, { depth: null, colors: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC2 运行失败：${message}`);
  process.exitCode = 1;
});
