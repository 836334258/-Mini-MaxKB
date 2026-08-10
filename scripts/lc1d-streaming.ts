import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import { configureAiNetworkFromEnv } from "../lib/ai/network";
import { createThreadConfig } from "../lib/langchain/memory-agent";
import {
  configureCourseModelAuthentication,
  createCourseChatModel,
  readCourseModelConfig,
} from "../lib/langchain/model-config";
import { createStreamingWeatherAgent } from "../lib/langchain/streaming-agent";

const DEFAULT_STREAMING_QUESTION = "上海今天的天气怎么样？";

type StreamingWeatherAgent = ReturnType<typeof createStreamingWeatherAgent>;
type ThreadConfig = ReturnType<typeof createThreadConfig>;

/** 从命令行读取问题；没有参数时使用一个必然触发天气工具的示例。 */
function readQuestion() {
  const argumentsWithoutSeparator = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  return (
    argumentsWithoutSeparator.join(" ").trim() || DEFAULT_STREAMING_QUESTION
  );
}

/** 把工具结果安全打印出来，保留对象结构而不是显示 [object Object]。 */
function printToolOutput(output: unknown) {
  if (typeof output === "string") {
    console.log(output);
    return;
  }
  console.dir(output, { depth: null, colors: true });
}

/** 判断 unknown 是否是可读取字段的普通对象或类实例。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 读取 LangChain 消息类型，同时避免把兼容层绑定到具体消息类。 */
function readMessageType(message: unknown) {
  if (!isRecord(message) || typeof message.getType !== "function") {
    return undefined;
  }
  return String(message.getType());
}

/**
 * 打印旧 streamMode 的节点更新，并从更新中提取工具调用。
 * 这是当前 Google Gemini 流式 function-call ID 缺口的兼容路径。
 */
function printLegacyUpdate(update: unknown) {
  if (!isRecord(update)) {
    return;
  }

  for (const [nodeName, nodeUpdate] of Object.entries(update)) {
    console.log(`[状态更新] ${nodeName}`);
    if (!isRecord(nodeUpdate) || !Array.isArray(nodeUpdate.messages)) {
      continue;
    }

    for (const message of nodeUpdate.messages) {
      if (!isRecord(message)) {
        continue;
      }
      const toolCalls = message.tool_calls;
      if (!Array.isArray(toolCalls)) {
        continue;
      }

      for (const toolCall of toolCalls) {
        if (!isRecord(toolCall)) {
          continue;
        }
        console.log(`[工具调用] ${String(toolCall.name ?? "unknown")}`);
        console.log("[工具参数]");
        console.dir(toolCall.args, { depth: null, colors: true });
      }
    }
  }
}

/**
 * 使用当前推荐的 v3 typed projections 消费同一次 Agent run。
 */
async function runTypedEventStream(
  agent: StreamingWeatherAgent,
  question: string,
  threadConfig: ThreadConfig,
) {
  const run = await agent.streamEvents(
    { messages: [{ role: "user", content: question }] },
    { ...threadConfig, version: "v3" },
  );

  await Promise.all([
    (async () => {
      for await (const message of run.messages) {
        let wroteText = false;
        for await (const token of message.text) {
          if (!wroteText) {
            process.stdout.write("\n[模型文本] ");
            wroteText = true;
          }
          process.stdout.write(token);
        }
        if (wroteText) {
          process.stdout.write("\n");
        }
      }
    })(),
    (async () => {
      for await (const call of run.toolCalls) {
        console.log(`\n[工具调用] ${call.name}`);
        console.log("[工具参数]");
        console.dir(call.input, { depth: null, colors: true });

        const [status, output, error] = await Promise.all([
          call.status,
          call.output,
          call.error,
        ]);
        console.log(`[工具状态] ${status}`);
        if (error) {
          console.log(`[工具错误] ${error}`);
        } else {
          console.log("[工具结果]");
          printToolOutput(output);
        }
      }
    })(),
  ]);

  return run.output;
}

/**
 * Google v3 工具事件暂时缺少 function-call ID，因此回退到多 streamMode。
 * 该路径仍会流式返回模型片段、节点进度和完整的工具执行结果。
 */
async function runGoogleCompatibilityStream(
  agent: StreamingWeatherAgent,
  question: string,
  threadConfig: ThreadConfig,
) {
  const stream = await agent.stream(
    { messages: [{ role: "user", content: question }] },
    { ...threadConfig, streamMode: ["updates", "messages"] },
  );

  for await (const rawChunk of stream) {
    const [streamMode, chunk] = rawChunk as [string, unknown];
    if (streamMode === "updates") {
      printLegacyUpdate(chunk);
      continue;
    }
    if (streamMode !== "messages" || !Array.isArray(chunk)) {
      continue;
    }

    const message = chunk[0];
    const messageType = readMessageType(message);
    if (!isRecord(message)) {
      continue;
    }

    if (messageType === "ai" && typeof message.content === "string") {
      if (message.content) {
        console.log(`[模型文本片段] ${message.content.replaceAll("\n", "\\n")}`);
      }
    } else if (messageType === "tool") {
      console.log("[工具结果]");
      printToolOutput(message.content);
    }
  }

  const snapshot = await agent.graph.getState(threadConfig);
  return snapshot.values;
}

/**
 * 默认使用 streamEvents v3；仅 Google provider 走经过真实验证的兼容回退。
 */
async function main() {
  loadEnvConfig(process.cwd());
  configureAiNetworkFromEnv();

  const modelConfig = readCourseModelConfig();
  configureCourseModelAuthentication(modelConfig);
  const model = await createCourseChatModel(modelConfig);
  const agent = createStreamingWeatherAgent(model);
  const question = readQuestion();
  const threadConfig = createThreadConfig(`lc1d-${randomUUID()}`);

  console.log("LC1D Agent 流式事件：");
  console.table(modelConfig);
  console.log(`用户问题：${question}`);

  let finalState: unknown;
  if (modelConfig.modelProvider === "google-genai") {
    console.log(
      "[兼容模式] 当前 Google 集成的 v3 工具事件缺少调用 ID，使用 streamMode 回退。",
    );
    finalState = await runGoogleCompatibilityStream(
      agent,
      question,
      threadConfig,
    );
  } else {
    finalState = await runTypedEventStream(agent, question, threadConfig);
  }

  console.log("\n[最终完整状态]");
  console.dir(finalState, { depth: null, colors: true });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC1D 运行失败：${message}`);
  process.exitCode = 1;
});
