import { all, now, type Row } from "./db";

/* Every number in the credit system lives here. Change them in one place. */
export const RULES = {
  starter: 20, // given once the college email is verified
  stake: 10, // held when you ask to join; lost if you leave or are voted gone
  live: 100, // pot for a project reviewers confirm is live and in use
  demo: 60, // pot for a project that works but is only a repo or demo
  soloFactor: 0.5, // solo projects have no teammates to sign, so they earn half
  vouch: 5, // a vouch from someone with fullWeightAt credit or more
  fullWeightAt: 200,
  fadeMonths: 18, // credit from projects older than this counts half
  reviewerMin: 50, // credit needed to review someone else's project
  reviewsNeeded: 2, // or one admin review
};

export type Line = { what: string; why: string; n: number };
export type Standing = {
  credit: number; base: number; ledger: Line[];
  shipped: number; building: number; left: number; joined: number;
  circle: boolean; mates: Set<number>;
};

/* Each member's share of a shipped project, in percent.
   Your share is the middle value of what your teammates gave you, then scaled so shares sum to 100.
   A teammate who has not filled in a split counts as giving everyone else an equal part. */
export function shares(ids: number[], allocs: Row[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 1) return out.set(ids[0], 100);
  const by = new Map<number, Map<number, number>>();
  for (const a of allocs) {
    if (!by.has(a.from_id)) by.set(a.from_id, new Map());
    by.get(a.from_id)!.set(a.to_id, a.pct);
  }
  const even = 100 / (ids.length - 1);
  const raw = new Map<number, number>();
  for (const x of ids) {
    const v = ids.filter((y) => y !== x).map((y) => (by.has(y) ? by.get(y)!.get(x) ?? 0 : even)).sort((a, b) => a - b);
    raw.set(x, v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  }
  const total = [...raw.values()].reduce((a, b) => a + b, 0);
  for (const x of ids) out.set(x, total ? (raw.get(x)! / total) * 100 : 100 / ids.length);
  return out;
}

export function projectShares(projectId: number): Map<number, number> {
  const ids = all("SELECT user_id FROM members WHERE project_id=? AND status='active'", projectId).map((r) => r.user_id);
  return shares(ids, all("SELECT * FROM allocations WHERE project_id=?", projectId));
}

/* Works out everyone's standing from the raw records. Nothing is stored, so it cannot drift. */
export function compute(): Map<number, Standing> {
  const S = new Map<number, Standing>();
  for (const u of all("SELECT id, verified, role FROM users")) {
    const s: Standing = { credit: 0, base: 0, ledger: [], shipped: 0, building: 0, left: 0, joined: 0, circle: false, mates: new Set() };
    if (u.verified && u.role === "student") s.ledger.push({ what: "Starter credit", why: "College email verified", n: RULES.starter });
    S.set(u.id, s);
  }
  const projects = all("SELECT * FROM projects");
  const members = all("SELECT * FROM members");
  const allocs = all("SELECT * FROM allocations");
  const fadeBefore = now() - RULES.fadeMonths * 30 * 86400;
  const shippedWith = new Map<number, Set<number>>();

  for (const p of projects) {
    const team = members.filter((m) => m.project_id === p.id);
    const active = team.filter((m) => m.status === "active").map((m) => m.user_id as number);
    for (const m of team) {
      const s = S.get(m.user_id);
      if (!s) continue;
      s.joined++;
      if (m.status === "left") {
        s.left++;
        if (m.stake) s.ledger.push({ what: `${p.name}: stake lost`, why: "Left before it shipped", n: -m.stake });
      } else if (p.status === "dropped") {
        if (m.user_id === p.lead_id) {
          s.left++;
          s.ledger.push({ what: `${p.name}: dropped`, why: "Dropped by its lead", n: -RULES.stake });
        }
      } else if (p.status === "shipped") {
        s.shipped++;
      } else {
        s.building++;
        if (m.stake) s.ledger.push({ what: `${p.name}: stake held`, why: "Returned when it ships", n: -m.stake });
      }
    }
    if (p.status !== "shipped") continue;
    const sh = shares(active, allocs.filter((a) => a.project_id === p.id));
    const solo = active.length === 1;
    const faded = (p.shipped_at ?? 0) < fadeBefore;
    for (const id of active) {
      const s = S.get(id);
      if (!s) continue;
      const pct = sh.get(id)!;
      const n = Math.round(p.pot * (pct / 100) * (solo ? RULES.soloFactor : 1) * (faded ? 0.5 : 1));
      const why = solo ? `Solo project, half of a ${p.pot} pot` : `${Math.round(pct)}% of a ${p.pot} pot, set by teammates`;
      s.ledger.push({ what: `${p.name} shipped`, why: why + (faded ? ", faded by age" : ""), n });
      if (!shippedWith.has(id)) shippedWith.set(id, new Set());
      for (const o of active) if (o !== id) { s.mates.add(o); shippedWith.get(id)!.add(o); }
    }
  }
  for (const r of all("SELECT r.user_id, p.name FROM requests r JOIN projects p ON p.id=r.project_id WHERE r.status='pending'")) {
    S.get(r.user_id)?.ledger.push({ what: `${r.name}: stake held`, why: "Waiting for the team to answer", n: -RULES.stake });
  }
  for (const s of S.values()) s.base = Math.max(0, s.ledger.reduce((a, l) => a + l.n, 0));

  // Vouches only count between people who shipped together, weigh more from high-credit people,
  // and count half when the two people vouched for each other.
  const vouches = all("SELECT * FROM vouches");
  const pair = new Set(vouches.map((v) => `${v.from_id}>${v.to_id}`));
  for (const v of vouches) {
    const to = S.get(v.to_id), from = S.get(v.from_id);
    if (!to || !from || !shippedWith.get(v.to_id)?.has(v.from_id)) continue;
    let n = RULES.vouch * Math.min(1, from.base / RULES.fullWeightAt);
    if (pair.has(`${v.to_id}>${v.from_id}`)) n /= 2;
    to.ledger.push({ what: "Vouch from a teammate", why: "Weighted by their own credit", n: Math.max(1, Math.round(n)) });
  }
  for (const s of S.values()) {
    s.credit = Math.max(0, s.ledger.reduce((a, l) => a + l.n, 0));
    s.circle = s.shipped >= 3 && s.mates.size <= 2;
  }
  return S;
}

export const EMPTY: Standing = { credit: 0, base: 0, ledger: [], shipped: 0, building: 0, left: 0, joined: 0, circle: false, mates: new Set() };
