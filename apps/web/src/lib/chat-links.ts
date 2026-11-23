/** Session id from `#/chat?sessionId=<id>` or `#/chat/<id>`, else null. */
export function sessionIdFromHash(hash: string): string | null {
  const h = hash.replace(/^#/, '');
  const queryStart = h.indexOf('?');
  if (queryStart !== -1) {
    const sid = new URLSearchParams(h.slice(queryStart + 1)).get('sessionId');
    if (sid) return sid;
  }
  const path = queryStart === -1 ? h : h.slice(0, queryStart);
  const m = path.match(/^\/chat\/([^/?#]+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}
