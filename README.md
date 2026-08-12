This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Mini-MaxKB learning path

### LangChain LC0: current official quickstart

LC0 follows the current JavaScript Quickstart and builds the smallest useful
agent with `createAgent`, a Zod-validated weather tool, and Gemini. It requires
Node.js 22 or newer. The weather result is intentionally fixed test data so the
lesson can focus on observing the tool-calling loop.

The Quickstart page currently shows `gemini-2.5-flash-lite`, but Google returns
HTTP 404 for new users because that model is no longer available to them. This
lesson therefore keeps the same official agent structure and uses the available
`gemini-3.5-flash` model.

The official Google integration reads `GOOGLE_API_KEY`. To preserve the
project's existing configuration, the lesson script reuses `GEMINI_API_KEY`
inside the server process when `GOOGLE_API_KEY` is absent. It never prints or
writes the key.

Run the offline tool contract test:

```bash
pnpm test:langchain:lc0
```

Run the real agent with the default question or provide your own:

```bash
pnpm langchain:lc0
pnpm langchain:lc0 -- "北京今天需要带伞吗？"
```

The script prints the complete agent state. The expected message sequence is
user message, model tool call, tool result, and final model answer.

### LangChain LC1A: system prompt and external text tool

LC1A begins the Quickstart's real-world research agent in two small steps. It
adds an actionable `systemPrompt` and a `fetch_text_from_url` tool. The tool
uses Node.js `fetch`, `AbortController`, and Zod like the official example,
while adding boundaries suitable for a server application:

- only public HTTPS text on `www.gutenberg.org` is allowed;
- redirects are rejected instead of silently leaving the allowlisted host;
- requests stop after 20 seconds;
- at most 20,000 characters are returned;
- the result explicitly says whether it is complete or truncated.

Run its offline security and truncation tests:

```bash
pnpm test:langchain:lc1
```

Run the real Agent with the built-in *Alice's Adventures in Wonderland*
question, or provide another Gutenberg URL and question:

```bash
pnpm langchain:lc1
pnpm langchain:lc1 -- "请读取 https://www.gutenberg.org/cache/epub/11/pg11.txt 并概括工具返回的片段"
```

The complete printed state should again contain four stages: user message,
model tool call, external text tool result, and grounded final answer. This
lesson does not add conversational memory yet; that is the next independent
concept.

### LangChain LC1B: configurable model objects

LC1B keeps the LC1A tools and system prompt unchanged, but initializes a chat
model object with a small provider factory before creating the Agent. The model
and Agent therefore have separate responsibilities:

- `createCourseChatModel` selects a provider and controls generation/network settings;
- `createResearchAgent` owns the system prompt, tools, and agent loop;
- provider API keys stay in server-side environment variables and are not part
  of the printable model configuration.

The factory uses explicit `ChatGoogleGenerativeAI` and `ChatDeepSeek` imports.
This keeps the replaceable-model boundary while allowing Next/Turbopack to see
both possible server dependencies at build time; `initChatModel` uses a package
name expression internally, which is suitable for the Node.js CLI lesson but
cannot be statically bundled in this Route Handler.

The default Gemini settings are intentionally conservative for grounded
research answers:

```bash
LANGCHAIN_MODEL_PROVIDER=google-genai
LANGCHAIN_MODEL=gemini-3.5-flash
LANGCHAIN_TEMPERATURE=0.2
LANGCHAIN_TIMEOUT_MS=120000
LANGCHAIN_MAX_TOKENS=2048
LANGCHAIN_MAX_RETRIES=2
```

Run the offline configuration tests and the real Agent:

```bash
pnpm test:langchain:lc1b
pnpm langchain:lc1b
```

The same Agent can use the installed DeepSeek integration without source-code
changes. Configure `DEEPSEEK_API_KEY` locally, then change only these values:

```bash
LANGCHAIN_MODEL_PROVIDER=deepseek
LANGCHAIN_MODEL=deepseek-chat
```

Use a DeepSeek model that supports tool calling. Provider model availability
can change, so the model name remains configuration rather than a hard-coded
Agent concern.

### LangChain LC1C: short-term conversation memory

LC1C adds a `MemorySaver` checkpointer to an Agent and supplies a `thread_id`
with every invocation. The two pieces have different jobs:

- `MemorySaver` stores Agent state in the current Node.js process;
- `thread_id` selects which conversation state to read and update;
- reusing one ID continues a conversation, while different IDs stay isolated.

Run the deterministic offline isolation test and the real three-turn example:

```bash
pnpm test:langchain:lc1c
pnpm langchain:lc1c
```

The real example writes a TypeScript preference into thread A, recalls it in a
second turn on thread A, and asks the same question in a new thread B. Thread B
must say it does not know because it cannot read thread A's history.

`MemorySaver` is intentionally temporary: all threads disappear when the
process restarts. A production MaxKB-style application should use a database
checkpointer and map an authenticated conversation ID to `thread_id`; that
persistent step is reserved for LC6 so this lesson stays focused.

### LangChain LC1D: typed event streaming

LC1D replaces the one-shot `invoke()` view with streaming. The current
`streamEvents` v3 API exposes independent typed projections that can be
consumed at the same time:

- `run.messages` streams incremental model text;
- `run.toolCalls` exposes each tool's name, input, status, output, and error;
- `run.output` resolves to the final complete Agent state.

Run the deterministic event-stream test and the real Gemini demonstration:

```bash
pnpm test:langchain:lc1d
pnpm langchain:lc1d
pnpm langchain:lc1d -- "北京今天的天气怎么样？"
```

The lesson continues to use LC0's fixed weather data. That guarantees a clear
model → tool → model sequence without mixing external weather API behavior into
the streaming concept.

The v3 projection API is recommended for new LangChain applications but is
still marked experimental in the installed version. Keep the stream adapter
isolated from UI code so a future API adjustment remains a local change.

There is one verified compatibility exception in the currently installed
`@langchain/google-genai@2.2.0`: Gemini v3 function-call events omit the call
ID, so the tool result cannot be correlated with that event. LC1D therefore
uses the supported `streamMode: ["updates", "messages"]` path for
`google-genai`, which correctly generates the ID and completes the
model → tool → model loop. Other configured providers use v3 projections.

### LangChain LC2: Document, Loader, and recursive text splitting

LC2 starts the RAG data pipeline without calling an Embedding or chat model. A
small local text Loader converts a UTF-8 Markdown/TXT file into LangChain's
standard `Document` shape:

- `pageContent` contains text that will later be embedded and retrieved;
- `metadata` records the source, title, and file type for traceability;
- `id` gives the original document and every generated chunk a stable identity.

`RecursiveCharacterTextSplitter` then tries paragraph, line, sentence,
punctuation, word, and character boundaries in order. The lesson adds Chinese
punctuation separators and preserves the source metadata on every chunk. It
also adds `chunkIndex` and `chunkCount`; LangChain adds `loc.lines`.

Run the offline tests and print every complete Document object:

```bash
pnpm test:langchain:lc2
pnpm langchain:lc2
```

Try different files and chunk parameters without changing source code:

```bash
pnpm langchain:lc2 -- --input data/l1-documents/security.md --chunk-size 100 --overlap 20
```

This lesson deliberately does not replace the earlier Mini-MaxKB custom
chunker. Keeping both implementations makes the mapping visible:
`content` becomes `pageContent`, while `source`, `title`, and `position` move
into `metadata`. Embedding and semantic retrieval are the next lesson.

### LangChain LC3: Embeddings and semantic search

LC3 converts every LC2 chunk into a vector and stores it in LangChain's
ephemeral `MemoryVectorStore`. It then converts the user question into a query
vector and returns the closest chunks with cosine-similarity scores.

The course adapter maps the existing replaceable Mini-MaxKB Embedding Provider
onto LangChain's two standard methods:

- `embedDocuments()` indexes knowledge chunks in a batch;
- `embedQuery()` embeds a user question for retrieval.

This separation matters because document and query embeddings can require
different provider-side task instructions. The chat model remains independent:
a future RAG answer may use DeepSeek while retrieval continues to use Google
Embedding.

Run the deterministic offline tests first, then use the Google key already
stored in `.env.local` for the real semantic-search demonstration:

```bash
pnpm test:langchain:lc3
pnpm langchain:lc3
pnpm langchain:lc3 -- --query "哪个阶段开始生成 RAG 回答？" --top-k 2
```

`MemoryVectorStore` performs an exact linear scan and disappears when the Node
process exits, so it is appropriate for this lesson rather than production.
Persistent vector databases and retrievers come later in the course.

### LangChain LC4: Retriever interface and metadata filtering

LC4 wraps the LC3 vector store with `asRetriever()`. The responsibilities are
now deliberately separate:

- `MemoryVectorStore` stores vectors and implements similarity search;
- `VectorStoreRetriever` is a Runnable that accepts a query through `invoke()`
  and returns `Document[]`;
- the Retriever's `k` controls the maximum number of returned documents;
- an optional metadata predicate limits which sources may participate.

The lesson indexes all three sample Markdown files so source filtering is
observable. Run the offline tests and the real Retriever:

```bash
pnpm test:langchain:lc4
pnpm langchain:lc4
```

Restrict retrieval to one source without changing the query:

```bash
pnpm langchain:lc4 -- --query "如何管理模型？" --source data/l1-documents/model-management.md --top-k 2
```

Unlike LC3's diagnostic `similaritySearchWithScore()`, a Retriever normally
returns documents without similarity scores. That simpler contract lets a
later prompt or RAG Chain depend on retrieval behavior without depending on a
specific vector database.

### LangChain LC5: minimal grounded RAG Chain

LC5 connects the existing pieces into the first complete retrieval-augmented
generation flow:

```text
question → Retriever → Document[] → numbered context → ChatPromptTemplate
         → replaceable ChatModel → StringOutputParser → answer + sources
```

The system prompt requires the model to use only retrieved context, cite facts
as `[资料 n]`, and treat retrieved text as data rather than instructions. If the
Retriever returns no documents, the Chain returns a fixed insufficient-context
answer without calling the chat model.

Run the offline orchestration tests and the real RAG example:

```bash
pnpm test:langchain:lc5
pnpm langchain:lc5
```

The chat model can be changed independently from Google Embedding:

```bash
pnpm langchain:lc5 -- --provider deepseek --model deepseek-chat --question "API Key 应该放在哪里？"
pnpm langchain:lc5 -- --provider google-genai --model gemini-3.5-flash --question "更换 Embedding 模型后要做什么？"
```

Prompt delimiters and instructions reduce accidental instruction-following
from retrieved text, but cannot completely prevent indirect prompt injection.
Production systems must still validate that answers and citations are grounded
in the returned source documents.

### LangChain LC6: history-aware conversational RAG

LC6 makes ambiguous follow-up questions searchable. With no history, the
original question goes directly to the Retriever. With history, a small query
rewrite Chain first turns a follow-up such as `为什么必须这样做？` into a
standalone question such as `为什么更换 Embedding 模型后必须重建索引？`.

```text
question + recent history → standalone query → Retriever → Documents
                       history + Documents → answer prompt → answer
```

The answer and query models use the same replaceable ChatModel by default, but
can be supplied independently. Only the six most recent complete turns are
converted into alternating human/AI messages, limiting token growth and stale
conversation interference.

Run the offline tests and real two-turn conversation:

```bash
pnpm test:langchain:lc6
pnpm langchain:lc6
```

Try a different follow-up or chat provider:

```bash
pnpm langchain:lc6 -- --question "API Key 应该放在哪里？" --follow-up "为什么不能放前端？"
pnpm langchain:lc6 -- --provider deepseek --model deepseek-chat
```

This lesson passes history explicitly in memory so the data flow remains
visible. Persisting conversations and reconstructing history by conversation
ID is the next separate concern.

### LangChain LC7: persistent conversation history with SQLite

LC7 stores each successful user/assistant turn in the project's existing
SQLite conversation schema. A `conversationId` identifies the thread. On a
later process start, the script reloads its ordered messages, pairs complete
user/assistant rows into LC6 history, and resumes the history-aware RAG Chain.

The course uses `.mini-maxkb/lc7-course.sqlite` by default so its demonstration
conversations do not pollute the existing Web application's database.

Start a new persistent conversation:

```bash
pnpm test:langchain:lc7
pnpm langchain:lc7 -- --question "更换 Embedding 模型后需要做什么？"
```

Copy the printed ID and continue it from a new Node process:

```bash
pnpm langchain:lc7 -- --conversation-id <printed-id> --question "为什么必须这样做？"
```

An existing conversation keeps its original chat provider and model, even if
different CLI model options are passed later. Only complete user/assistant
pairs are restored; an interrupted, unmatched row is excluded from model
history. LC7 persists message text for memory teaching, while the existing Web
RAG flow remains responsible for persistent scored source snapshots.

### LangChain LC8: Next.js streaming RAG Route Handler

LC8 exposes the persistent conversational Chain through an isolated Next.js
Route Handler at `POST /api/langchain-course/chat`. It uses the Web
`ReadableStream`, `Response`, and `TextEncoder` APIs to emit NDJSON events:

```text
conversation → status → rewrite → sources → delta... → done
```

The server caches the in-memory vector-store Promise by embedding configuration
and source-file modification state. API keys are excluded from the cache key
and response. A changed source file, model, or vector dimension rebuilds the
index; repeated chat requests in the same server process reuse it.

Run the offline stream/HTTP validation tests, then start Next.js:

```bash
pnpm test:langchain:lc8
pnpm langchain:lc8
pnpm dev
```

`pnpm langchain:lc8` directly executes and consumes the same Route Handler with
the Web Request/Response APIs. It is useful for observing the stream before a
browser client exists; `pnpm dev` verifies the actual HTTP endpoint.

Continue the ID printed by the smoke command:

```bash
pnpm langchain:lc8 -- --conversation-id <printed-id> --question "为什么必须这样做？"
```

From another terminal, observe each NDJSON event without response buffering:

```bash
curl.exe -N -X POST http://localhost:3000/api/langchain-course/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"更换 Embedding 模型后需要做什么？\"}"
```

Send the returned conversation ID with a follow-up request to restore SQLite
history. The route stores the user row before generation and the assistant row
only after the stream finishes. An interrupted unmatched user row is ignored
when conversation history is reconstructed.

### LangChain LC9: browser NDJSON streaming client

LC9 adds an isolated Client Component at `/langchain-course` without replacing
the existing Mini-MaxKB home page. The browser sends a question to the LC8
Route Handler and uses `response.body.getReader()` plus `TextDecoder` to consume
the NDJSON response incrementally.

A network chunk is not a JSON event boundary: one JSON line may be split across
multiple byte chunks, and several lines may arrive together. The client keeps a
text buffer, parses only complete newline-delimited records, and translates each
typed event into a focused UI update:

```text
conversation -> remember the SQLite conversation ID
status       -> show the current server stage
rewrite      -> show the standalone follow-up question
sources      -> render the retrieved document chunks
delta        -> append text to the assistant message
done         -> replace the draft with the saved final message
```

Start the app and open the course page:

```bash
pnpm dev
```

Visit [http://localhost:3000/langchain-course](http://localhost:3000/langchain-course),
ask one complete question, and then ask a short follow-up such as “为什么必须这样做？”.
The same `conversationId` is sent on the second request, so LC8 can restore the
SQLite history and emit a visible `rewrite` event. Provider and model controls
are locked after the first message because each saved conversation pins its
original model configuration.

Run the byte-boundary and HTTP-error client tests with:

```bash
pnpm test:langchain:lc9
```

### L0: replaceable chat models

L0 keeps the UI unchanged and introduces a small provider layer inspired by
MaxKB. The command-line chat uses one normalized message format while the
Gemini and DeepSeek adapters translate it to their own HTTP APIs.

1. Copy `.env.example` to `.env.local`.
2. Set `AI_PROVIDER` and the matching API key and model.
3. Start the chat:

```bash
pnpm chat:l0
```

You can override the active provider and model without changing source code:

```bash
pnpm chat:l0 -- --provider deepseek --model deepseek-v4-flash
pnpm chat:l0 -- --provider gemini --model gemini-3.5-flash
```

Run the offline provider contract tests with:

```bash
pnpm test:l0
```

After configuring real API keys, verify a two-turn conversation with:

```bash
pnpm smoke:l0 -- --provider deepseek
pnpm smoke:l0 -- --provider gemini
```

### L1: document semantic search

L1 configures the embedding model separately from the chat model. Build a local
JSON vector index from the sample Markdown documents:

```bash
pnpm l1:index
```

Then search by meaning rather than exact keywords:

```bash
pnpm l1:search -- --query "更换向量模型后要做什么"
```

Custom document folders can contain `.md` and `.txt` files:

```bash
pnpm l1:index -- --input C:\path\to\documents
```

### L2: command-line RAG

L2 combines the L1 vector index with the replaceable L0 chat provider. It
retrieves the most relevant document chunks, sends numbered context to the
model, and prints both the answer and its retrieved sources:

```bash
pnpm l1:index -- --chunk-size 600 --overlap 80
pnpm l2:ask -- --query "更换向量模型后要做什么"
```

The chat provider and model can still be replaced without changing source
code:

```bash
pnpm l2:ask -- --query "如何保护 API Key" --provider deepseek --model deepseek-v4-flash
pnpm l2:ask -- --query "如何保护 API Key" --provider gemini --model gemini-3.5-flash
```

Run the offline RAG orchestration tests with:

```bash
pnpm test:l2
```

### L3: Web knowledge base

L3 adds a Next.js Web workspace, Route Handlers, an NDJSON streaming response,
and local SQLite persistence for conversations, messages, and source snapshots.
API keys stay in server-side environment variables and are never returned by
the settings endpoint.

Prepare the vector index and start the app:

```bash
pnpm l1:index -- --chunk-size 600 --overlap 80
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). A new conversation can
choose Gemini or DeepSeek; once its first message is sent, that conversation
keeps the selected model. The default database is stored at
`.mini-maxkb/mini-maxkb.sqlite` and remains outside Git.

Run the SQLite persistence test with:

```bash
pnpm test:l3
```

### L4: enterprise RAG retrieval

L4 keeps the L2 semantic-search path intact and upgrades the Web application
to hybrid retrieval. It combines vector similarity with lightweight BM25
keyword scores, filters low-confidence results, and exposes retrieval scores
for diagnosis. If no result reaches the configured threshold, the chat model
is not called and the application returns a reliable insufficient-context
answer.

The server-side defaults can be tuned in `.env.local`:

```bash
RAG_TOP_K=3
RAG_CANDIDATE_K=12
RAG_MIN_SCORE=0.45
RAG_SEMANTIC_WEIGHT=0.7
```

Run the offline behavior tests:

```bash
pnpm test:l4
```

Run the labeled retrieval evaluation with the configured real Embedding model:

```bash
pnpm eval:l4
```

The sample evaluation set is stored in `data/l4-evaluation.json` and reports
Hit@K, mean reciprocal rank, and out-of-domain rejection accuracy. Add real
business questions to this file before tuning the threshold or score weights.

### L5A: knowledge base management

L5A starts the platform layer without replacing the L1–L4 learning baseline.
The built-in sample knowledge base remains read-only and keeps using
`.mini-maxkb/l1-index.json`. Each custom knowledge base stores its uploaded
`.md` and `.txt` documents and its vector index in a separate directory under
`.mini-maxkb/knowledge-bases`.

Start the Web app and open the management page:

```bash
pnpm dev
```

Visit [http://localhost:3000/knowledge-bases](http://localhost:3000/knowledge-bases),
create a knowledge base, and upload a UTF-8 `.md` or `.txt` file up to 2 MB.
The server rebuilds that knowledge base's complete index after each upload.
Return to the chat page and choose the knowledge base before sending the first
message. Existing conversations keep their originally selected knowledge base.

Run the offline SQLite and isolated-index tests with:

```bash
pnpm test:l5a
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
