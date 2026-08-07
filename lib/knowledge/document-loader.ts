import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface SourceDocument {
  source: string;
  title: string;
  content: string;
}

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }),
  );

  return nested.flat();
}

function getDocumentTitle(filePath: string, content: string) {
  const markdownHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return markdownHeading || path.basename(filePath, path.extname(filePath));
}

export async function loadDocuments(inputDirectory: string) {
  const root = path.resolve(inputDirectory);
  const files = (await listFiles(root))
    .filter((filePath) => SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  const documents: SourceDocument[] = [];

  for (const filePath of files) {
    const content = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "").trim();

    if (!content) {
      continue;
    }

    documents.push({
      source: path.relative(root, filePath).replaceAll(path.sep, "/"),
      title: getDocumentTitle(filePath, content),
      content,
    });
  }

  return documents;
}
