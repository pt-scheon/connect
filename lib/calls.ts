import { all, get, run, now, type Row } from "./db";
import { notify } from "./notify";

/* Voice and video calls. Audio and video go straight between the two browsers (WebRTC); the server only rings
   people and passes the connection details between them. One call at a time per person. */

export const RING_SECONDS = 45;

/* Where browsers look for a route to each other. STUN works on most home and college Wi-Fi. Mobile data and
   strict networks often need a TURN relay: set TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL to use one. */
export function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
  const turn = (process.env.TURN_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
  if (turn.length) list.push({ urls: turn, username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" });
  return list;
}

/* Which tabs are listening for calls right now, so a call whose people have closed their tabs gets ended. */
const g = globalThis as unknown as { __presence?: Map<string, number> };
const presence = (g.__presence ??= new Map());
export const ping = (userId: number, device: string) => presence.set(`${userId}:${device}`, Date.now());
export const drop = (userId: number, device: string) => presence.delete(`${userId}:${device}`);
const alive = (userId: number, device: string | null) => !!device && Date.now() - (presence.get(`${userId}:${device}`) ?? 0) < 20_000;
export const online = (userId: number) => [...presence].some(([k, t]) => k.startsWith(`${userId}:`) && Date.now() - t < 20_000);

export const liveCall = (userId: number): Row | undefined =>
  get("SELECT * FROM voice_calls WHERE (caller_id=? OR callee_id=?) AND status IN ('ringing','active') ORDER BY id DESC LIMIT 1", userId, userId);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* Ends a call and leaves a line in the chat: "Video call · 3:12", "Missed voice call", "Declined voice call". */
export function finish(c: Row, status: "ended" | "missed" | "declined" | "failed", by: number | null) {
  if (!["ringing", "active"].includes(c.status)) return;
  const t = now();
  if (!run("UPDATE voice_calls SET status=?, ended_at=?, ended_by=? WHERE id=? AND status IN ('ringing','active')", status, t, by, c.id).changes) return;
  const kind = c.video ? "video call" : "voice call";
  const text = status === "ended" && c.answered_at ? `${c.video ? "Video" : "Voice"} call · ${clock(t - c.answered_at)}`
    : status === "declined" ? `Declined ${kind}` : status === "failed" ? `${c.video ? "Video" : "Voice"} call could not connect` : `Missed ${kind}`;
  const missed = status === "missed" || (status === "ended" && !c.answered_at);
  run("INSERT INTO messages (from_id, to_id, text, kind, seen, created_at) VALUES (?,?,?,?,?,?)", c.caller_id, c.callee_id, text, "call", missed ? 0 : 1, t);
  if (missed) {
    const who = get("SELECT name FROM users WHERE id=?", c.caller_id)?.name ?? "Someone";
    notify(c.callee_id, `Missed ${kind} from ${who}`, `/messages/${c.caller_id}`);
  }
  for (const id of [c.caller_id, c.callee_id]) signal(c.id, id, null, "ended", { status, by });
}

export function signal(callId: number, to: number, device: string | null, type: string, payload: unknown) {
  run("INSERT INTO call_signals (call_id, to_id, to_device, type, payload, created_at) VALUES (?,?,?,?,?,?)", callId, to, device, type, JSON.stringify(payload ?? null), now());
}

/* Rings that went unanswered become missed calls; calls whose people have gone away are ended. */
export function sweep() {
  const t = now();
  for (const c of all("SELECT * FROM voice_calls WHERE status='ringing' AND created_at<?", t - RING_SECONDS)) finish(c, "missed", null);
  for (const c of all("SELECT * FROM voice_calls WHERE status='ringing' AND created_at<?", t - 8))
    if (!alive(c.caller_id, c.caller_device)) finish(c, "ended", c.caller_id);
  for (const c of all("SELECT * FROM voice_calls WHERE status='active' AND answered_at<?", t - 20))
    if (!alive(c.caller_id, c.caller_device) || !alive(c.callee_id, c.callee_device)) finish(c, "ended", null);
  run("DELETE FROM call_signals WHERE created_at<?", t - 120);
}
