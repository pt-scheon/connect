import { all, get, type Row } from "./db";

/* Your conversations, newest first: who, the last message, and how many you have not read. */
export function conversations(me: Row): { u: Row; last: Row; unread: number }[] {
  const pairs = all(
    `SELECT other, MAX(id) last FROM (
       SELECT CASE WHEN from_id=? THEN to_id ELSE from_id END other, id FROM messages WHERE from_id=? OR to_id=?
     ) GROUP BY other ORDER BY last DESC LIMIT 100`, me.id, me.id, me.id);
  const blocked = new Set(all("SELECT blocked_id FROM blocks WHERE user_id=?", me.id).map((b) => b.blocked_id));
  const unread = new Map(all("SELECT from_id, COUNT(*) n FROM messages WHERE to_id=? AND seen=0 GROUP BY from_id", me.id).map((r) => [r.from_id, r.n]));
  return pairs
    .filter((p) => !blocked.has(p.other))
    .map((p) => ({
      u: get("SELECT id, name, picture, branch, college_id, deleted FROM users WHERE id=?", p.other),
      last: get("SELECT * FROM messages WHERE id=?", p.last),
      unread: unread.get(p.other) ?? 0,
    }))
    .filter((c) => c.u && c.u.college_id === me.college_id);
}

/* Unread messages for the header badge, not counting people you blocked. */
export function unreadMessages(userId: number): number {
  return get(
    "SELECT COUNT(*) n FROM messages WHERE to_id=? AND seen=0 AND from_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id=?)", userId, userId,
  )?.n ?? 0;
}
