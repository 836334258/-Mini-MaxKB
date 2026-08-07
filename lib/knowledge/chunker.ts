import type { SourceDocument } from "./document-loader";

export interface DocumentChunk {
  id: string;
  source: string;
  title: string;
  position: number;
  content: string;
}

interface ChunkOptions {
  maxCharacters?: number;
  overlapCharacters?: number;
}

function sliceLongText(text: string, maxCharacters: number, overlap: number) {
  const slices: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxCharacters, text.length);
    slices.push(text.slice(start, end).trim());

    if (end === text.length) {
      break;
    }

    start = end - overlap;
  }

  return slices.filter(Boolean);
}

export function chunkDocument(
  document: SourceDocument,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const maxCharacters = options.maxCharacters ?? 600;
  const overlap = options.overlapCharacters ?? 80;

  if (maxCharacters <= 0 || overlap < 0 || overlap >= maxCharacters) {
    throw new Error("分段参数必须满足 maxCharacters > overlapCharacters >= 0");
  }

  const paragraphs = document.content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const contents: string[] = [];
  let current = "";

  const flush = () => {
    if (current) {
      contents.push(current);
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      flush();
      contents.push(...sliceLongText(paragraph, maxCharacters, overlap));
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxCharacters) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  flush();

  return contents.map((content, position) => ({
    id: `${document.source}#${position}`,
    source: document.source,
    title: document.title,
    position,
    content,
  }));
}

export function chunkDocuments(
  documents: SourceDocument[],
  options: ChunkOptions = {},
) {
  return documents.flatMap((document) => chunkDocument(document, options));
}
