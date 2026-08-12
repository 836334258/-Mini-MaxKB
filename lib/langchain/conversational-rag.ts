import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";
import type { VectorStoreRetriever } from "@langchain/core/vectorstores";
import type { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

import { invokeCourseRetriever } from "./course-retriever";
import {
  COURSE_RAG_SYSTEM_PROMPT,
  EMPTY_CONTEXT_ANSWER,
  formatDocumentsAsContext,
  type CourseRagResult,
} from "./rag-chain";

export const MAX_CONVERSATION_HISTORY_TURNS = 6;

export interface CourseConversationTurn {
  question: string;
  answer: string;
}

export interface ConversationalRagInput {
  question: string;
  history?: CourseConversationTurn[];
}

export interface ConversationalRagResult extends CourseRagResult {
  standaloneQuestion: string;
}

export interface ConversationalRagModels {
  answerModel: BaseChatModel;
  queryModel?: BaseChatModel;
}

export type ConversationalRagStreamEvent =
  | { type: "rewrite"; standaloneQuestion: string }
  | { type: "sources"; sources: CourseRagResult["sources"] }
  | { type: "delta"; content: string }
  | { type: "done"; result: ConversationalRagResult };

const HISTORY_AWARE_QUERY_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你负责把对话中的最新问题改写成可以脱离聊天历史、独立用于知识库检索的问题。
不要回答问题，不要添加解释，只输出一条完整的独立检索问题。
保留上一轮中与最新问题有关的实体、操作和条件。`,
  ],
  new MessagesPlaceholder("chatHistory"),
  ["human", "最新问题：{question}"],
]);

const CONVERSATIONAL_ANSWER_PROMPT = ChatPromptTemplate.fromMessages([
  ["system", COURSE_RAG_SYSTEM_PROMPT],
  new MessagesPlaceholder("chatHistory"),
  [
    "human",
    `<retrieved_context>
{context}
</retrieved_context>

请回答最新问题：{question}`,
  ],
]);

/**
 * 把应用层的问答记录转换成 LangChain 消息，并只保留最近 6 轮。
 * 使用固定的人类/AI 角色，避免数据库内容伪装成新的 system 指令。
 */
export function conversationTurnsToMessages(
  history: CourseConversationTurn[] = [],
): BaseMessage[] {
  const recentTurns = history.slice(-MAX_CONVERSATION_HISTORY_TURNS);

  return recentTurns.flatMap((turn, index) => {
    const question = turn.question.trim();
    const answer = turn.answer.trim();

    if (!question || !answer) {
      throw new Error(`第 ${index + 1} 条对话历史的问题和回答不能为空`);
    }

    return [new HumanMessage(question), new AIMessage(answer)];
  });
}

/**
 * 创建对话式 RAG：历史问题改写 → 检索 → 携带历史和资料生成回答。
 * queryModel 默认复用 answerModel，也可以替换成更快、更便宜的模型。
 */
export function createConversationalRagChain(
  retriever: VectorStoreRetriever<MemoryVectorStore>,
  models: ConversationalRagModels,
) {
  const queryModel = models.queryModel ?? models.answerModel;
  const rewriteChain = HISTORY_AWARE_QUERY_PROMPT.pipe(queryModel).pipe(
    new StringOutputParser(),
  );
  const answerChain = CONVERSATIONAL_ANSWER_PROMPT.pipe(
    models.answerModel,
  ).pipe(new StringOutputParser());

  return RunnableLambda.from<ConversationalRagInput, ConversationalRagResult>(
    async (input) => {
      const question = input.question.trim();

      if (!question) {
        throw new Error("对话式 RAG 问题不能为空");
      }

      const chatHistory = conversationTurnsToMessages(input.history);
      const rewrittenQuestion =
        chatHistory.length > 0
          ? (
              await rewriteChain.invoke({
                chatHistory,
                question,
              })
            ).trim()
          : question;
      const standaloneQuestion = rewrittenQuestion || question;
      const sources = await invokeCourseRetriever(
        retriever,
        standaloneQuestion,
      );

      if (sources.length === 0) {
        return {
          answer: EMPTY_CONTEXT_ANSWER,
          sources,
          standaloneQuestion,
        };
      }

      const answer = await answerChain.invoke({
        chatHistory,
        question,
        context: formatDocumentsAsContext(sources),
      });

      return {
        answer: answer.trim(),
        sources,
        standaloneQuestion,
      };
    },
  );
}

/**
 * 流式运行对话式 RAG，并按“改写、来源、文本增量、完成”依次产出事件。
 * Route Handler 可以直接把这些领域事件翻译成 NDJSON，而无需了解 Prompt。
 */
export async function* streamConversationalRag(
  retriever: VectorStoreRetriever<MemoryVectorStore>,
  models: ConversationalRagModels,
  input: ConversationalRagInput,
): AsyncGenerator<ConversationalRagStreamEvent> {
  const question = input.question.trim();
  if (!question) {
    throw new Error("对话式 RAG 问题不能为空");
  }

  const queryModel = models.queryModel ?? models.answerModel;
  const rewriteChain = HISTORY_AWARE_QUERY_PROMPT.pipe(queryModel).pipe(
    new StringOutputParser(),
  );
  const answerChain = CONVERSATIONAL_ANSWER_PROMPT.pipe(
    models.answerModel,
  ).pipe(new StringOutputParser());
  const chatHistory = conversationTurnsToMessages(input.history);
  const rewrittenQuestion =
    chatHistory.length > 0
      ? (
          await rewriteChain.invoke({
            chatHistory,
            question,
          })
        ).trim()
      : question;
  const standaloneQuestion = rewrittenQuestion || question;

  yield { type: "rewrite", standaloneQuestion };

  const sources = await invokeCourseRetriever(retriever, standaloneQuestion);
  yield { type: "sources", sources };

  if (sources.length === 0) {
    const result = {
      answer: EMPTY_CONTEXT_ANSWER,
      sources,
      standaloneQuestion,
    };
    yield { type: "delta", content: result.answer };
    yield { type: "done", result };
    return;
  }

  let answer = "";
  const answerStream = await answerChain.stream({
    chatHistory,
    question,
    context: formatDocumentsAsContext(sources),
  });

  for await (const content of answerStream) {
    if (!content) {
      continue;
    }
    answer += content;
    yield { type: "delta", content };
  }

  yield {
    type: "done",
    result: {
      answer: answer.trim(),
      sources,
      standaloneQuestion,
    },
  };
}
