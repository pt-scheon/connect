import { all, now, type Row } from "./db";
import { RULES, MONTH } from "./rules";
import { credibility, credWeight, rings, type Cred } from "./credibility";

export { RULES } from "./rules";

/* One ledger line. `held` lines are credit set aside for now (a stake, an escrow) or spent on a commission:
   they lower what you can use, never what you have earned. */
export type Line = { what: string; why: string; n: number; held?: boolean };
export type Standing = {
  credit: number; // what you can stake, escrow or send right now
  earned: number; // everything earned from verified work, less penalties. Spending does not lower it.
  base: number; ledger: Line[];
  shipped: number; building: number; left: number; joined: number;
  circle: boolean; ring: boolean; mates: Set<number>;
  cred: Cred; // credibility, 0 to 100, with the lines that explain it
};
const NO_CRED: Cred = { score: 0, lines: [], finishRate: RULES.cred.priorFinish };
const blank = (): Standing => ({ credit: 0, earned: 0, base: 0, ledger: [], shipped: 0, building: 0, left: 0, joined: 0, circle: false, ring: false, mates: new Set(), cred: NO_CRED });

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
  const users = all("SELECT id, verified, role, created_at FROM users");
  const t = now();
  for (const u of users) {
    const s = blank();
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
        if (m.stake) s.ledger.push({ what: `${p.name}: stake held`, why: "Returned when it ships", n: -m.stake, held: true });
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
    S.get(r.user_id)?.ledger.push({ what: `${r.name}: stake held`, why: "Waiting for the team to answer", n: -RULES.stake, held: true });
  }
  // Reviews that have a final outcome. New ones are logged when a round is decided; older ones are judged against the pot.
  const judged = new Map<number, { matched: number; total: number }>();
  const judge = (id: number, ok: boolean) => {
    const j = judged.get(id) ?? { matched: 0, total: 0 };
    j.total++; if (ok) j.matched++;
    judged.set(id, j);
  };
  const log = all("SELECT * FROM review_log ORDER BY created_at");
  const logged = new Set(log.map((r) => r.project_id));
  for (const r of log) judge(r.reviewer_id, r.verdict === r.outcome);
  const pots = new Map(projects.filter((p) => p.status === "shipped").map((p) => [p.id, p.pot]));
  for (const r of all("SELECT * FROM reviews")) if (pots.has(r.project_id) && !logged.has(r.project_id)) judge(r.reviewer_id, r.verdict === pots.get(r.project_id));

  // A review that matched the outcome earns a little, up to a cap every 30 days.
  const rewards = new Map<number, Map<number, number>>();
  for (const r of log) {
    if (r.verdict !== r.outcome) continue;
    const m = rewards.get(r.reviewer_id) ?? new Map<number, number>(), w = Math.floor(r.created_at / MONTH);
    rewards.set(r.reviewer_id, m.set(w, Math.min(RULES.reviewRewardCap, (m.get(w) ?? 0) + RULES.reviewReward)));
  }
  for (const [id, m] of rewards) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    S.get(id)?.ledger.push({ what: "Accurate reviews", why: `${RULES.reviewReward} for each review that matched the final outcome`, n });
  }
  for (const s of S.values()) s.base = Math.max(0, s.ledger.reduce((a, l) => a + l.n, 0));

  // Credibility comes before vouches, because a vouch weighs as much as the person giving it can be trusted.
  const vouches = all("SELECT * FROM vouches").filter((v) => shippedWith.get(v.to_id)?.has(v.from_id));
  const inRing = rings(vouches, shippedWith);
  const upheld = new Map<number, number[]>();
  for (const r of all("SELECT target_id, created_at FROM reports WHERE kind='user' AND result='upheld'"))
    upheld.set(r.target_id, [...(upheld.get(r.target_id) ?? []), r.created_at ?? t]);
  for (const u of users) {
    const s = S.get(u.id)!;
    s.circle = s.shipped >= 3 && s.mates.size <= 2;
    s.ring = inRing.has(u.id);
    const j = judged.get(u.id);
    s.cred = credibility({
      shipped: s.shipped, left: s.left, mates: s.mates.size, circle: s.circle, ring: s.ring,
      reviewsMatched: j?.matched ?? 0, reviewsTotal: j?.total ?? 0, evidenceOk: 0, evidenceBad: 0,
      createdAt: u.created_at, upheld: upheld.get(u.id) ?? [],
    }, t);
  }

  // Vouches only count between people who shipped together and count half when the two vouched for each other.
  // A vouch weighs as much as the voucher's credibility, a quarter inside a ring, and only the strongest few count.
  // Vouches from before the cutover keep the weight they had (by the voucher's credit), so nothing dropped that day.
  const pair = new Set(vouches.map((v) => `${v.from_id}>${v.to_id}`));
  const fresh = new Map<number, number[]>(), old = new Map<number, number>();
  for (const v of vouches) {
    const to = S.get(v.to_id), from = S.get(v.from_id);
    if (!to || !from) continue;
    const mutual = pair.has(`${v.to_id}>${v.from_id}`) ? 0.5 : 1;
    if ((v.created_at ?? 0) < RULES.cutover) {
      const n = Math.max(1, Math.round(RULES.vouch * Math.min(1, from.base / RULES.fullWeightAt) * mutual));
      to.ledger.push({ what: "Vouch from a teammate", why: "Weighted by their own credit", n });
      old.set(v.to_id, (old.get(v.to_id) ?? 0) + 1);
    } else {
      const ring = inRing.has(v.from_id) && inRing.has(v.to_id) ? RULES.ringFactor : 1;
      fresh.set(v.to_id, [...(fresh.get(v.to_id) ?? []), RULES.vouch * credWeight(from.cred.score) * mutual * ring]);
    }
  }
  for (const [id, list] of fresh) {
    const room = Math.max(0, RULES.vouchesCounted - (old.get(id) ?? 0));
    for (const n of list.sort((a, b) => b - a).slice(0, room))
      S.get(id)!.ledger.push({ what: "Vouch from a teammate", why: "Weighted by how far their word can be trusted", n: Math.max(1, Math.round(n)) });
  }
  for (const s of S.values()) {
    s.credit = Math.max(0, s.ledger.reduce((a, l) => a + l.n, 0));
    s.earned = Math.max(0, s.ledger.reduce((a, l) => a + (l.held ? 0 : l.n), 0));
  }
  return S;
}

export const EMPTY: Standing = blank();
