import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET } from "../../app/api/langchain-course/conversations/[id]/route";
import { ConversationRepository } from "../../lib/db/conversation-repository";

test("LC10 会话接口从课程 SQLite 恢复消息并处理不存在的 ID", async () => {
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), "mini-maxkb-lc10-"),
  );
  const databasePath = path.join(temporaryDirectory, "course.sqlite");
  const originalDatabasePath = process.env.LANGCHAIN_COURSE_DATABASE_PATH;

  try {
    process.env.LANGCHAIN_COURSE_DATABASE_PATH = databasePath;
    const repository = new ConversationRepository(databasePath);
    const conversation = repository.createConversation({
      title: "LC10 恢复测试",
      provider: "gemini",
      model: "gemini-test",
      knowledgeBaseId: "langchain-course",
    });
    repository.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "刷新后还能看到吗？",
    });
    repository.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "消息由 SQLite 恢复。",
    });
    repository.close();

    const foundResponse = await GET(
      new Request(`http://localhost/api/langchain-course/conversations/${conversation.id}`),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    assert.equal(foundResponse.status, 200);
    assert.equal(foundResponse.headers.get("Cache-Control"), "no-store");
    const foundBody = (await foundResponse.json()) as {
      conversation: { id: string; messages: Array<{ content: string }> };
    };
    assert.equal(foundBody.conversation.id, conversation.id);
    assert.deepEqual(
      foundBody.conversation.messages.map((message) => message.content),
      ["刷新后还能看到吗？", "消息由 SQLite 恢复。"],
    );

    const missingResponse = await GET(
      new Request("http://localhost/api/langchain-course/conversations/missing"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: "会话不存在" });
  } finally {
    if (originalDatabasePath === undefined) {
      delete process.env.LANGCHAIN_COURSE_DATABASE_PATH;
    } else {
      process.env.LANGCHAIN_COURSE_DATABASE_PATH = originalDatabasePath;
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
