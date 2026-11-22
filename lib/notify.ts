import { all, get, run, now } from "./db";
import { emailNote } from "./mail";
import { lineText } from "./identity";

/* An entry in someone's inbox. One that names a person has NAME (lib/identity.ts) for the name and their id as `actor`. */
export function notify(userId: number, text: string, href: string, actor = 0) {
  run("INSERT INTO notifications (user_id, text, href, created_at, actor_id) VALUES (?,?,?,?,?)", userId, text, href, now(), actor);
  // An email cannot be changed later, so it gets the name they go by as it is sent.
  emailNote(userId, lineText({ text, actor_id: actor }), href);
}

/* A line on a project's timeline. kind "event" is written by the app, "post" by a teammate. `actor` as in notify. */
export function logUpdate(projectId: number, userId: number | null, text: string, kind: "event" | "post" = "event", actor = 0) {
  run("INSERT INTO updates (project_id, user_id, kind, text, created_at, actor_id) VALUES (?,?,?,?,?,?)", projectId, userId, kind, text, now(), actor);
  if (kind === "post" || FOLLOWED.test(text)) tellFollowers(projectId, userId, text);
}

/* The moments worth telling followers about; renames, joins and reviewer notes stay on the timeline only. */
const FOLLOWED = /^(Milestone done|Sent for review|Shipped|Dropped|Reviewers sent it back)/;
function tellFollowers(projectId: number, actor: number | null, text: string) {
  const p = get("SELECT name FROM projects WHERE id=? AND hidden=0", projectId);
  if (!p) return;
  const short = text.length > 90 ? text.slice(0, 87) + "..." : text;
  // Teammates already hear about their own project; only outsiders who follow it are told here.
  for (const f of all(
    "SELECT f.user_id FROM follows f JOIN users u ON u.id=f.user_id WHERE f.project_id=? AND u.deleted=0 AND u.suspended=0 AND u.follow_notes=1 AND f.user_id NOT IN (SELECT user_id FROM members WHERE project_id=? AND status='active')",
    projectId, projectId))
    if (f.user_id !== actor) notify(f.user_id, `${p.name}: ${short}`, `/projects/${projectId}`);
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

/* The visitor's address as the host in front of us reports it. Only used to slow down floods, never stored. */
export const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || "unknown";

/* "Chrome on Windows" from a browser's user-agent line. Rough on purpose: enough for someone to recognise their own device. */
export function deviceName(ua: string | null | undefined): string {
  const u = String(ua || "");
  const os = /iPhone|iPad|iPod/.test(u) ? "iPhone or iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : /Mac OS X|Macintosh/.test(u) ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux" : "";
  const br = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /Firefox\/|FxiOS/.test(u) ? "Firefox" : /Chrome\/|CriOS/.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
  return br && os ? `${br} on ${os}` : br || os || "an unknown device";
}
