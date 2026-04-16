/**
 * Simple token estimation using character-based heuristic.
 * Rough estimate: ~4 characters per token on average for English text.
 * Used for pre-flight checks, not billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateMessageTokens(
  messages: Array<{ content: string; role: string }>,
): number {
  let total = 0;
  for (const msg of messages) {
    // Add overhead per message for role/formatting (~4 tokens)
    total += 4;
    total += estimateTokens(msg.content);
  }
  return total;
}

/**
 * Check whether a request is likely to exceed a given token limit.
 */
export function willExceedLimit(
  messages: Array<{ content: string; role: string }>,
  limit: number,
): boolean {
  return estimateMessageTokens(messages) > limit;
}
