import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { StoredMessage } from "../../lib/conversations/types";
import { ConversationRepository } from "../../lib/db/conversation-repository";
import {
  loadPersistentCourseConversation,
  savePersistentCourseTurn,
  storedMessagesToConversationTurns,
  toCourseModelProvider,
  toStoredChatProvider,
} from "../../lib/langchain/persistent-conversation";

function createStoredMessage(
  role: "user" | "assistant",
  content: string,
  index: number,
): StoredMessage {
  return {
    id: `message-${index}`,
    conversationId: "conversation-1",
    role,
    content,
    sources: [],
    createdAt: `2026-08-11T00:00:0${index}.000Z`,
  };
}

test("LC7 只把完整的 user/assistant 消息对恢复成历史轮次", () => {
  const turns = storedMessagesToConversationTurns([
    createStoredMessage("assistant", "孤立回答", 0),
    createStoredMessage("user", "第一问", 1),
    createStoredMessage("assistant", "第一答", 2),
    createStoredMessage("user", "未完成问题", 3),
  ]);

  assert.deepEqual(turns, [{ question: "第一问", answer: "第一答" }]);
});

test("LC7 SQLite 关闭并重新打开后仍能按 conversationId 恢复历史", () => {
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), "mini-maxkb-lc7-"),
  );
  const databasePath = path.join(temporaryDirectory, "course.sqlite");
  let conversationId = "";

  try {
    const firstProcess = new ConversationRepository(databasePath);
    try {
      const conversation = firstProcess.createConversation({
        title: "持久化课程",
        provider: "gemini",
        model: "gemini-test",
        knowledgeBaseId: "langchain-course",
      });
      conversationId = conversation.id;
      savePersistentCourseTurn(firstProcess, conversationId, {
        question: "更换 Embedding 模型后要做什么？",
        answer: "需要重建索引。",
      });
    } finally {
      firstProcess.close();
    }

    const secondProcess = new ConversationRepository(databasePath);
    try {
      const restored = loadPersistentCourseConversation(
        secondProcess,
        conversationId,
      );

      assert.equal(restored.conversation.model, "gemini-test");
      assert.equal(restored.conversation.messages.length, 2);
      assert.deepEqual(restored.history, [
        {
          question: "更换 Embedding 模型后要做什么？",
          answer: "需要重建索引。",
        },
      ]);
    } finally {
      secondProcess.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("LC7 正确映射课程模型和已有会话的 provider 名称", () => {
  assert.equal(toStoredChatProvider("google-genai"), "gemini");
  assert.equal(toStoredChatProvider("deepseek"), "deepseek");
  assert.equal(toCourseModelProvider("gemini"), "google-genai");
  assert.equal(toCourseModelProvider("deepseek"), "deepseek");
});

test("LC7 拒绝不存在的 conversationId", () => {
  const repository = new ConversationRepository(":memory:");

  try {
    assert.throws(
      () => loadPersistentCourseConversation(repository, "missing"),
      /会话不存在/,
    );
  } finally {
    repository.close();
  }
});
