import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { configureAiNetworkFromEnv } from "../lib/ai/network";
import {
  evaluateCourseRetrieval,
  type CourseEvaluationCase,
} from "../lib/langchain/course-evaluation";
import { getCourseKnowledgeRuntime } from "../lib/langchain/course-knowledge-runtime";
import { searchCourseVectorStore } from "../lib/langchain/semantic-search";

/** 读取 `--name value` 或 `--name=value` 参数。 */
function readArgument(name: string, fallback: string) {
  const args = process.argv.slice(2);
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

/** 读取并验证 LC12 JSON 评测集的基础结构。 */
async function loadCourseEvaluationCases(filePath: string) {
  const raw = await readFile(path.resolve(filePath), "utf8");
  const cases = JSON.parse(raw) as CourseEvaluationCase[];

  if (
    !Array.isArray(cases) ||
    cases.some(
      (item) =>
        typeof item.id !== "string" ||
        typeof item.query !== "string" ||
        !Array.isArray(item.expectedSources),
    )
  ) {
    throw new Error("LC12 评测集格式不正确");
  }

  return cases;
}

/** 使用当前 Embedding 配置运行可重复的检索质量基线。 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const datasetPath = readArgument(
    "--dataset",
    "data/lc12-course-evaluation.json",
  );
  const k = Number(readArgument("--k", "2"));
  const minScore = Number(readArgument("--min-score", "0.6"));
  const cases = await loadCourseEvaluationCases(datasetPath);
  const runtime = await getCourseKnowledgeRuntime();
  const report = await evaluateCourseRetrieval(
    cases,
    (query, topK) => searchCourseVectorStore(runtime.vectorStore, query, topK),
    { k, minScore },
  );

  console.log("LC12 LangChain 课程检索评估\n");
  console.log(
    `Embedding: ${runtime.embeddingProvider} / ${runtime.embeddingModel}`,
  );
  console.log(`k=${k}, minScore=${minScore}\n`);

  for (const item of report.items) {
    const result = item.expectedRejection
      ? item.rejected
        ? "正确拒答"
        : "错误放行"
      : item.hit
        ? "命中"
        : "未命中";
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
  console.error(`LC12 评估失败：${message}`);
  process.exitCode = 1;
});
