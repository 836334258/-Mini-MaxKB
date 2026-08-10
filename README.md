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
model object with `initChatModel` before creating the Agent. The model and Agent
therefore have separate responsibilities:

- `initChatModel` selects a provider and controls generation/network settings;
- `createResearchAgent` owns the system prompt, tools, and agent loop;
- provider API keys stay in server-side environment variables and are not part
  of the printable model configuration.

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
