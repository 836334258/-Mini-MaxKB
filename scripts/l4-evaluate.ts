import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { readEmbeddingProviderConfig } from "../lib/ai/embedding-config";
import { createEmbeddingProvider } from "../lib/ai/embedding-registry";
import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  evaluateRetrieval,
  type RetrievalEvaluationCase,
} from "../lib/evaluation/retrieval-evaluation";
import {
  assertIndexCompatible,
  loadVectorIndex,
} from "../lib/knowledge/vector-index";
import { readRetrievalConfig } from "../lib/rag/retrieval-config";

/** 读取 `--name value` 或 `--name=value` 参数，并支持默认值。 */
function readArgument(name: string, fallback: string) {
  const args = process.argv.slice(2);
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

/** 加载标注评测集并检查最基本的 JSON 结构。 */
async function loadEvaluationCases(filePath: string) {
  const raw = await readFile(path.resolve(filePath), "utf8");
  const cases = JSON.parse(raw) as RetrievalEvaluationCase[];
  if (
    !Array.isArray(cases) ||
    cases.some(
      (item) =>
        !item.id ||
        !item.query ||
        !Array.isArray(item.expectedSources),
    )
  ) {
    throw new Error("L4 评测集格式不正确");
  }
  return cases;
}

/** 批量向量化评测问题，运行检索指标并逐项打印命中情况。 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();
  const datasetPath = readArgument("--dataset", "data/l4-evaluation.json");
  const indexPath = readArgument("--index", ".mini-maxkb/l1-index.json");
  const evaluationCases = await loadEvaluationCases(datasetPath);
  const embeddingConfig = readEmbeddingProviderConfig();
  const embeddingProvider = createEmbeddingProvider(embeddingConfig);
  const vectorIndex = await loadVectorIndex(indexPath);
  assertIndexCompatible(vectorIndex, embeddingConfig);

  const embedding = await embeddingProvider.embed({
    purpose: "query",
    inputs: evaluationCases.map((item) => ({ text: item.query })),
  });
  const report = evaluateRetrieval(
    evaluationCases,
    embedding.vectors,
    vectorIndex.chunks,
    readRetrievalConfig(),
  );

  console.log("L4 混合检索评测\n");
  for (const item of report.items) {
    const result = item.expectedRejection
      ? item.rejected ? "正确拒答" : "错误放行"
      : item.hit ? "命中" : "未命中";
    console.log(
      `${result.padEnd(4)} | ${item.id} | top=${item.topScore?.toFixed(4) ?? "-"} | ${item.retrievedSources.join(", ") || "无来源"}`,
    );
  }
  console.log(`\nHit@K: ${(report.hitAtK * 100).toFixed(1)}%`);
  console.log(`MRR: ${report.meanReciprocalRank.toFixed(4)}`);
  console.log(
    `拒答准确率: ${(report.rejectionAccuracy * 100).toFixed(1)}%`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`L4 评测失败：${message}`);
  process.exitCode = 1;
});
