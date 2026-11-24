/**
 * Knowledge loop: the server id of the answer being regenerated, if the
 * client knows it. A just-streamed answer still carries a temporary id
 * (`__streaming__` or `msg_<timestamp>`) until the session re-syncs; for
 * those we send nothing and the server falls back to the session's latest
 * answer.
 */
export function regenerateOfFor(messageId: string | undefined | null): string | undefined {
  if (!messageId) return undefined;
  if (
    messageId === '__streaming__' ||
    messageId.startsWith('msg_') ||
    messageId.startsWith('user_')
  ) {
    return undefined;
  }
  return messageId;
}
