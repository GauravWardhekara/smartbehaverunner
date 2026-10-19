/** Normalize text for VS Code OutputChannel.append (expects CRLF chunks). */
export function normalizeToCrlfChunk(text: string): string {
  const normalized = text.includes("\r\n") ? text : text.replace(/\n/g, "\r\n");
  return normalized.endsWith("\r\n") ? normalized : normalized + "\r\n";
}
