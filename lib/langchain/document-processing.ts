import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_TEXT_EXTENSIONS = new Set([".md", ".txt"]);

/**
 * 原始文档的追踪信息。
 * pageContent 保存要被检索的正文，metadata 保存正文来自哪里。
 */
export interface CourseDocumentMetadata {
  source: string;
  title: string;
  fileType: "markdown" | "text";
}

/**
 * 文档切块后追加的追踪信息。
 * loc 由 LangChain 文本切分器生成，用来记录该块在原文中的行号。
 */
export interface CourseChunkMetadata extends CourseDocumentMetadata {
  chunkIndex: number;
  chunkCount: number;
  loc?: {
    lines?: {
      from: number;
      to: number;
    };
  };
}

export interface SplitDocumentOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

/**
 * 递归切分器会按顺序尝试这些分隔符：先保留段落，再保留句子，
 * 最后才退化到词和单个字符。补充中文标点可以避免只按空格切中文。
 */
export const CHINESE_RECURSIVE_SEPARATORS = [
  "\n\n",
  "\n",
  "。",
  "！",
  "？",
  "；",
  ".",
  "!",
  "?",
  ";",
  "，",
  "、",
  ",",
  "\u200b",
  " ",
  "",
];

/** 把 Windows 路径统一成适合写入 metadata 的正斜杠格式。 */
function normalizeSourcePath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

/** 优先使用 Markdown 一级标题，没有标题时退回到文件名。 */
function readDocumentTitle(filePath: string, content: string) {
  return (
    content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    path.basename(filePath, path.extname(filePath))
  );
}

/**
 * 读取一个 UTF-8 Markdown/TXT 文件，并转换成 LangChain Document。
 * Loader 的职责是统一数据结构，不负责切块、向量化或调用聊天模型。
 */
export async function loadTextDocument(
  inputPath: string,
  sourceRoot = process.cwd(),
): Promise<Document<CourseDocumentMetadata>> {
  const absolutePath = path.resolve(inputPath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (!SUPPORTED_TEXT_EXTENSIONS.has(extension)) {
    throw new Error("LC2 目前只支持 UTF-8 编码的 .md 和 .txt 文件");
  }

  const pageContent = (await readFile(absolutePath, "utf8"))
    .replace(/^\uFEFF/, "")
    .trim();

  if (!pageContent) {
    throw new Error(`文档内容为空：${absolutePath}`);
  }

  const relativePath = path.relative(path.resolve(sourceRoot), absolutePath);
  const isOutsideSourceRoot =
    relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
  const source = normalizeSourcePath(
    isOutsideSourceRoot ? path.basename(absolutePath) : relativePath,
  );

  return new Document({
    id: source,
    pageContent,
    metadata: {
      source,
      title: readDocumentTitle(absolutePath, pageContent),
      fileType: extension === ".md" ? "markdown" : "text",
    },
  });
}

/**
 * 使用 LangChain 递归字符切分器生成可追踪的 Document chunks。
 * 原始 metadata 会被保留，并为每个块补上稳定 ID、序号和总块数。
 */
export async function splitCourseDocument(
  document: Document<CourseDocumentMetadata>,
  options: SplitDocumentOptions = {},
): Promise<Array<Document<CourseChunkMetadata>>> {
  const chunkSize = options.chunkSize ?? 120;
  const chunkOverlap = options.chunkOverlap ?? 20;

  if (
    !Number.isInteger(chunkSize) ||
    !Number.isInteger(chunkOverlap) ||
    chunkSize <= 0 ||
    chunkOverlap < 0 ||
    chunkOverlap >= chunkSize
  ) {
    throw new Error("切块参数必须满足 chunkSize > chunkOverlap >= 0，且都是整数");
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: CHINESE_RECURSIVE_SEPARATORS,
  });
  const splitDocuments = await splitter.splitDocuments([document]);
  const chunkCount = splitDocuments.length;

  return splitDocuments.map(
    (chunk, chunkIndex) =>
      new Document<CourseChunkMetadata>({
        id: `${document.id ?? document.metadata.source}#chunk-${chunkIndex}`,
        pageContent: chunk.pageContent,
        metadata: {
          ...document.metadata,
          ...chunk.metadata,
          chunkIndex,
          chunkCount,
        },
      }),
  );
}

/** 组合 Loader 和 Splitter，供 CLI 或后续 RAG 索引流程直接调用。 */
export async function loadAndSplitTextDocument(
  inputPath: string,
  options: SplitDocumentOptions = {},
) {
  const document = await loadTextDocument(inputPath);
  const chunks = await splitCourseDocument(document, options);

  return { document, chunks };
}
