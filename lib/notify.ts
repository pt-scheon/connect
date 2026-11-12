import { run, now } from "./db";

/* An entry in someone's inbox. */
export function notify(userId: number, text: string, href: string) {
  run("INSERT INTO notifications (user_id, text, href, created_at) VALUES (?,?,?,?)", userId, text, href, now());
}

/* A line on a project's timeline. kind "event" is written by the app, "post" by a teammate. */
export function logUpdate(projectId: number, userId: number | null, text: string, kind: "event" | "post" = "event") {
  run("INSERT INTO updates (project_id, user_id, kind, text, created_at) VALUES (?,?,?,?,?)", projectId, userId, kind, text, now());
}

/* Simple per-person rate limit, kept in memory. Good for one server; swap for Redis if you run several. */
const hits = new Map<string, number[]>();
export function allow(key: string, max: number, perSeconds: number): boolean {
  const t = Date.now(), from = t - perSeconds * 1000;
  const list = (hits.get(key) ?? []).filter((x) => x > from);
  if (list.length >= max) return hits.set(key, list), false;
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > from)) hits.delete(k);
  return true;
}

export function timeAgo(t: number): string {
  const s = Math.max(1, now() - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t * 1000).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
