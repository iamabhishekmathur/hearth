/**
 * Splits text into overlapping chunks suitable for embedding.
 * Uses paragraph boundaries when possible, falls back to sentence splitting.
 */

const DEFAULT_CHUNK_SIZE = 1000; // characters
const DEFAULT_OVERLAP = 200;

export interface Chunk {
  text: string;
  index: number;
}

export function chunkText(
  text: string,
  options?: { chunkSize?: number; overlap?: number },
): Chunk[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;

  if (!text || text.trim().length === 0) return [];
  if (text.length <= chunkSize) return [{ text: text.trim(), index: 0 }];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastParagraph = slice.lastIndexOf('\n\n');
      const lastSentence = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
      );

      if (lastParagraph > chunkSize * 0.5) {
        end = start + lastParagraph + 2;
      } else if (lastSentence > chunkSize * 0.5) {
        end = start + lastSentence + 2;
      }
    }

    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push({ text: chunkText, index });
      index++;
    }

    start = end - overlap;
    if (start >= text.length) break;
    // Avoid infinite loop if overlap is too large
    if (start <= chunks[chunks.length - 1]?.text.length ? 0 : start) {
      start = end;
    }
  }

  return chunks;
}
