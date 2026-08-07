This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Mini-MaxKB learning path

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
