import { all, now, type Row } from "./db";
import { RULES, MONTH } from "./rules";
import { shares, type Standing } from "./credit";
import { credWeight } from "./credibility";

/* Competency: how good someone is at one skill, from 0 to 100, with how sure we are.
   A skill only counts when someone else confirmed the person used it: teammates on a shipped project,
   reviewers on a solo one, the client of a commission, or whoever verified a piece of outside evidence.
   The skills a person lists on their own profile are never an input. */

/* ---------- skill names ---------- */
const ALIASES: Record<string, string> = {
  "nextjs": "next.js", "next": "next.js", "reactjs": "react", "react.js": "react", "node.js": "node", "nodejs": "node",
  "js": "javascript", "ts": "typescript", "py": "python", "postgresql": "postgres", "machine learning": "ml",
  "ui/ux": "ui design", "ux": "ui design", "ui": "ui design", "pcb": "pcb design", "3d print": "3d printing",
  "c++": "c++", "cpp": "c++", "embedded": "embedded c", "tf": "tensorflow", "rn": "react native",
};
const LABELS: Record<string, string> = {
  "next.js": "Next.js", "ml": "ML", "ai": "AI", "pcb design": "PCB design", "ui design": "UI design", "esp32": "ESP32", "stm32": "STM32",
  "fpga": "FPGA", "cad": "CAD", "3d printing": "3D printing", "sql": "SQL", "css": "CSS", "html": "HTML", "api": "API", "pid": "PID",
  "ios": "iOS", "fastapi": "FastAPI", "javascript": "JavaScript", "typescript": "TypeScript", "pytorch": "PyTorch", "tensorflow": "TensorFlow",
  "embedded c": "Embedded C", "rfid": "RFID", "matlab": "MATLAB",
};
/* One spelling per skill, so "NextJS" and "next.js" are the same thing. */
export function canon(s: string): string {
  const k = s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 30);
  return ALIASES[k] ?? k;
}
export const label = (k: string) => LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
/* A typed list ("React, Node, figma") as distinct skill names, in the order given. */
export const parseSkills = (text: string, max = 8): string[] =>
  [...new Set(String(text || "").split(/[,\n]/).map(canon).filter((k) => k.length > 1))].slice(0, max);

/* A code sent to a work address proves the person has a mailbox at that company, not what they did there. */
export const WORK_EMAIL_TRUST = 0.7;

/* ---------- the formula ---------- */
export type Evidence = {
  skill: string; q: number; w: number; tier: "A" | "B";
  kind: "project" | "solo" | "commission" | "hackathon" | "internship";
  label: string; at: number;
};
export type SkillScore = { skill: string; label: string; score: number; conf: number; band: "low" | "medium" | "high"; why: string; items: Evidence[] };

/* A weighted average that starts at the prior and needs real weight behind it to move:
   score = (k·prior + Σ w·q) / (k + Σ w). One lucky project cannot make an expert. */
export function rate(items: { q: number; w: number }[]): { score: number; conf: number } {
  const K = RULES.skill, sw = items.reduce((a, i) => a + i.w, 0), swq = items.reduce((a, i) => a + i.w * i.q, 0);
  return { score: (100 * (K.k * K.prior / 100 + swq)) / (K.k + sw), conf: sw / (sw + K.k) };
}
export const recency = (at: number, t: number) => Math.pow(0.5, Math.max(0, t - at) / (RULES.skill.halfLifeMonths * MONTH));
export const band = (conf: number): SkillScore["band"] => (conf < RULES.skill.confLow ? "low" : conf < RULES.skill.confHigh ? "medium" : "high");

const NOUN: Record<Evidence["kind"], [string, string]> = {
  project: ["shipped project", "shipped projects"], solo: ["solo project", "solo projects"], commission: ["commission", "commissions"],
  hackathon: ["hackathon", "hackathons"], internship: ["internship", "internships"],
};
/* "based on 3 shipped projects and 1 commission" */
export function reason(items: Evidence[]): string {
  const parts = (Object.keys(NOUN) as Evidence["kind"][]).map((k) => [k, items.filter((i) => i.kind === k).length] as const)
    .filter(([, n]) => n > 0).map(([k, n]) => `${n} ${NOUN[k][n === 1 ? 0 : 1]}`);
  return "based on " + (parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]);
}
export function summarise(items: Evidence[]): Map<string, SkillScore> {
  const by = new Map<string, Evidence[]>();
  for (const i of items) by.set(i.skill, [...(by.get(i.skill) ?? []), i]);
  const out = new Map<string, SkillScore>();
  for (const [skill, list] of by) {
    const r = rate(list);
    out.set(skill, { skill, label: label(skill), score: Math.round(r.score), conf: r.conf, band: band(r.conf), why: reason(list), items: list });
  }
  return out;
}

/* ---------- evidence from the records ---------- */
/* How good the work was, for one person on one shipped project: the reviewers' verdict, nudged by their share. */
export function projectQuality(pot: number, share: number, equal: number): number {
  const K = RULES.skill, base = pot >= RULES.live ? K.qLive : K.qDemo;
  const nudge = Math.max(0.6, Math.min(1.1, 1 - K.shareBoost + K.shareBoost * (share / equal)));
  return Math.min(1, base * nudge);
}

/* Which skills count for whom on a project, and who signed for them. A teammate's skill needs ticks from at least
   half of the others on the team. A solo project needs a tick from one of its reviewers or an admin. */
export function confirmedSkills(team: number[], ticks: Row[], reviewers: Set<number>, admins: Set<number>): Map<number, Map<string, number[]>> {
  const out = new Map<number, Map<string, number[]>>();
  for (const x of team) {
    const others = team.filter((y) => y !== x), solo = team.length === 1;
    const need = solo ? 1 : Math.max(1, Math.ceil(others.length / 2));
    const by = new Map<string, number[]>();
    for (const t of ticks) {
      if (t.user_id !== x || t.by_id === x) continue;
      if (solo ? !(reviewers.has(t.by_id) || admins.has(t.by_id)) : !others.includes(t.by_id)) continue;
      by.set(t.skill, [...new Set([...(by.get(t.skill) ?? []), t.by_id as number])]);
    }
    out.set(x, new Map([...by].filter(([, who]) => who.length >= need)));
  }
  return out;
}

/* Everyone's skill scores, worked out from the raw records. Nothing is stored. */
export function competency(S: Map<number, Standing>): Map<number, Map<string, SkillScore>> {
  const t = now(), K = RULES.skill;
  const items = new Map<number, Evidence[]>();
  const add = (id: number, e: Evidence) => { if (e.w > 0) items.set(id, [...(items.get(id) ?? []), e]); };
  const trust = (ids: number[], admins: Set<number>) =>
    ids.length ? ids.reduce((a, id) => a + (admins.has(id) ? 1 : credWeight(S.get(id)?.cred.score)), 0) / ids.length : 0;

  const admins = new Set<number>(all("SELECT id FROM users WHERE admin=1").map((u) => u.id));
  const members = all("SELECT * FROM members WHERE status='active'"), allocs = all("SELECT * FROM allocations");
  const ticks = all("SELECT * FROM member_skills");
  const reviewers = new Map<number, Set<number>>();
  for (const r of [...all("SELECT project_id, reviewer_id FROM reviews"), ...all("SELECT project_id, reviewer_id FROM review_log")])
    reviewers.set(r.project_id, (reviewers.get(r.project_id) ?? new Set()).add(r.reviewer_id));

  for (const p of all("SELECT * FROM projects WHERE status='shipped'")) {
    const team = members.filter((m) => m.project_id === p.id).map((m) => m.user_id as number);
    if (!team.length) continue;
    const sh = shares(team, allocs.filter((a) => a.project_id === p.id)), equal = 100 / team.length, solo = team.length === 1;
    const ok = confirmedSkills(team, ticks.filter((x) => x.project_id === p.id), reviewers.get(p.id) ?? new Set(), admins);
    for (const id of team) {
      const pct = sh.get(id) ?? 0;
      for (const [skill, who] of ok.get(id) ?? []) {
        add(id, {
          skill, tier: "A", kind: solo ? "solo" : "project", label: p.name, at: p.shipped_at ?? t,
          q: projectQuality(p.pot, pct, equal),
          w: K.tier.A * recency(p.shipped_at ?? t, t) * (solo ? RULES.soloFactor : Math.min(1, pct / equal)) * trust(who, admins),
        });
      }
    }
  }
  // Outside evidence (tier B): checked by an admin, a teammate on Connect, or a code sent to a work email.
  // It can lift a skill, at half the weight of work Connect saw happen.
  for (const e of all("SELECT * FROM evidence WHERE status='verified' AND kind IN ('hackathon','internship')")) {
    const q = e.kind === "hackathon" ? (e.value === "won" ? K.qHackWin : e.value === "finalist" ? K.qHackFinal : K.qHackTookPart) : K.qInternship;
    const by = e.method === "work_email" ? WORK_EMAIL_TRUST : e.method === "admin" ? 1 : credWeight(S.get(e.decided_by)?.cred.score);
    for (const skill of parseSkills(e.skills))
      add(e.user_id, { skill, tier: "B", kind: e.kind === "hackathon" ? "hackathon" : "internship", label: e.title, at: e.created_at, q, w: K.tier.B * recency(e.created_at, t) * by });
  }
  return new Map([...items].map(([id, list]) => [id, summarise(list)]));
}
