import assert from "node:assert/strict";
import test from "node:test";

import { ConversationRepository } from "../../lib/db/conversation-repository";

test("SQLite 保存会话、消息和 RAG 来源快照", () => {
  const repository = new ConversationRepository(":memory:");

  try {
    const conversation = repository.createConversation({
      title: "如何切换模型",
      provider: "deepseek",
      model: "deepseek-test",
      knowledgeBaseId: "product-manual",
    });
    repository.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "如何切换模型？",
    });
    repository.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "修改配置后重新索引。[1]",
      sources: [
        {
          id: "models.md#0",
          source: "models.md",
          title: "模型管理",
          position: 0,
          score: 0.91,
          content: "更换向量模型后需要重新索引。",
        },
      ],
    });

    const stored = repository.getConversation(conversation.id);
    assert.equal(stored?.provider, "deepseek");
    assert.equal(stored?.knowledgeBaseId, "product-manual");
    assert.deepEqual(
      stored?.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(stored?.messages[1].sources[0].source, "models.md");
    assert.equal(repository.listConversations()[0].id, conversation.id);
  } finally {
    repository.close();
  }
});
