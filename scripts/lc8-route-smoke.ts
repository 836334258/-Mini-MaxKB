import { loadEnvConfig } from "@next/env";

import { POST } from "../app/api/langchain-course/chat/route";
import type { CourseChatStreamEvent } from "../lib/langchain/course-chat-stream";

const DEFAULT_QUESTION = "更换 Embedding 模型后需要做什么？";

/** 读取 `--name value` 或 `--name=value` 两种命令行参数格式。 */
function readArgument(name: string, fallback: string) {
  const argumentsList = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
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

/** 打印一个已经从 NDJSON 行解析出的课程事件。 */
function printEvent(event: CourseChatStreamEvent) {
  if (event.type === "delta") {
    process.stdout.write(event.content);
    return;
  }

  if (event.type === "conversation") {
    console.log(`conversationId：${event.conversation.id}`);
  } else if (event.type === "status") {
    console.log(`status：${event.message}`);
  } else if (event.type === "rewrite") {
    console.log(`rewrite：${event.standaloneQuestion}`);
  } else if (event.type === "sources") {
    console.log(
      `sources：${event.sources.map((source) => source.source).join(", ")}`,
    );
    console.log("answer：");
  } else if (event.type === "done") {
    console.log(`\ndone：assistantMessage=${event.message.id}`);
  } else {
    console.log(`error：${event.message}`);
  }
}

/**
 * 在当前 Node 22 进程直接执行 Next Route Handler，并逐块消费 Web Response。
 * 这能在不重启用户已有开发服务器时验证真实数据库和模型流。
 */
async function main() {
  loadEnvConfig(process.cwd());
  const question = readArgument("--question", DEFAULT_QUESTION);
  const conversationId = readArgument("--conversation-id", "").trim();
  const response = await POST(
    new Request("http://localhost/api/langchain-course/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: question,
        ...(conversationId ? { conversationId } : {}),
      }),
    }),
  );

  console.log(`HTTP ${response.status}`);
  console.log(`Content-Type：${response.headers.get("Content-Type")}`);

  if (!response.ok || !response.body) {
    console.log(await response.text());
    process.exitCode = 1;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedText = "";

  while (true) {
    const { done, value } = await reader.read();
    bufferedText += decoder.decode(value, { stream: !done });
    const lines = bufferedText.split("\n");
    bufferedText = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        printEvent(JSON.parse(line) as CourseChatStreamEvent);
      }
    }

    if (done) {
      break;
    }
  }

  if (bufferedText.trim()) {
    printEvent(JSON.parse(bufferedText) as CourseChatStreamEvent);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LC8 Route smoke 失败：${message}`);
  process.exitCode = 1;
});
