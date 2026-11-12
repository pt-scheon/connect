/* Tests for the credit rules. Run with: npm test
   Uses a throwaway database, never the real one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "connect-test-")), "test.db");

async function setup() {
  const { run, now, TABLES } = await import("../lib/db");
  const { compute, shares, RULES } = await import("../lib/credit");
  for (const t of TABLES) run(`DELETE FROM ${t}`);
  let n = 0;
  const user = (verified = 1) =>
    Number(run("INSERT INTO users (sub, name, verified, onboarded, created_at) VALUES (?,?,?,1,?)", `t:${++n}`, `User ${n}`, verified, now()).lastInsertRowid);
  const project = (status: string, pot: number, team: number[], opts: { left?: number[]; shippedAt?: number } = {}) => {
    const pid = Number(run("INSERT INTO projects (name, pitch, status, lead_id, pot, created_at, shipped_at) VALUES ('P','p',?,?,?,?,?)",
      status, team[0], pot, now(), status === "shipped" ? opts.shippedAt ?? now() : null).lastInsertRowid);
    for (const u of team) run("INSERT INTO members (project_id, user_id) VALUES (?,?)", pid, u);
    for (const u of opts.left ?? []) run("INSERT INTO members (project_id, user_id, status, stake) VALUES (?,?,'left',?)", pid, u, RULES.stake);
    return pid;
  };
  const give = (pid: number, from: number, to: number, pct: number) =>
    run("INSERT INTO allocations (project_id, from_id, to_id, pct) VALUES (?,?,?,?)", pid, from, to, pct);
  return { run, now, compute, shares, RULES, user, project, give };
}

test("a verified student starts with starter credit, an unverified one with none", async () => {
  const { compute, user, RULES } = await setup();
  const a = user(1), b = user(0);
  const S = compute();
  assert.equal(S.get(a)!.credit, RULES.starter);
  assert.equal(S.get(b)!.credit, 0);
});

test("with no splits filled in, a shipped pot is shared equally", async () => {
  const { compute, user, project, RULES } = await setup();
  const [a, b, c] = [user(), user(), user()];
  project("shipped", 90, [a, b, c]);
  const S = compute();
  for (const u of [a, b, c]) assert.equal(S.get(u)!.credit, RULES.starter + 30);
});

test("your share is the middle of what teammates gave you, and you cannot set your own", async () => {
  const { shares } = await setup();
  // 1 tries to give itself everything by starving the others: that only changes what 2 and 3 receive from 1.
  const allocs = [
    { from_id: 1, to_id: 2, pct: 0 }, { from_id: 1, to_id: 3, pct: 100 },
    { from_id: 2, to_id: 1, pct: 50 }, { from_id: 2, to_id: 3, pct: 50 },
    { from_id: 3, to_id: 1, pct: 50 }, { from_id: 3, to_id: 2, pct: 50 },
  ];
  const sh = shares([1, 2, 3], allocs);
  assert.equal(Math.round(sh.get(1)! + sh.get(2)! + sh.get(3)!), 100);
  assert.equal(Math.round(sh.get(1)!), 33); // 50 and 50 from the others, out of 150 handed out
  assert.ok(sh.get(3)! > sh.get(2)!);
});

test("a solo project earns half the pot", async () => {
  const { compute, user, project, RULES } = await setup();
  const a = user();
  project("shipped", 100, [a]);
  assert.equal(compute().get(a)!.credit, RULES.starter + 100 * RULES.soloFactor);
});

test("leaving a project loses the stake, and dropping one costs the lead", async () => {
  const { compute, user, project, RULES } = await setup();
  const [lead, mate, quitter] = [user(), user(), user()];
  project("building", 0, [lead, mate], { left: [quitter] });
  project("dropped", 0, [lead, mate]);
  const S = compute();
  assert.equal(S.get(quitter)!.credit, RULES.starter - RULES.stake);
  assert.equal(S.get(quitter)!.left, 1);
  assert.equal(S.get(lead)!.credit, RULES.starter - RULES.stake);
  assert.equal(S.get(mate)!.credit, RULES.starter);
});

test("a vouch only counts between people who shipped together, and mutual vouches count half", async () => {
  const { run, now, compute, user, project, RULES } = await setup();
  const [a, b, stranger] = [user(), user(), user()];
  project("shipped", 100, [a, b]);
  const before = compute().get(a)!.credit;
  run("INSERT INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", stranger, a, now());
  assert.equal(compute().get(a)!.credit, before, "a stranger's vouch is worth nothing");
  run("INSERT INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", b, a, now());
  const oneWay = compute().get(a)!.credit - before;
  assert.ok(oneWay >= 1 && oneWay <= RULES.vouch);
  run("INSERT INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", a, b, now());
  assert.ok(compute().get(a)!.credit - before <= oneWay, "a mutual vouch is never worth more");
});

test("credit from an old project counts half", async () => {
  const { now, compute, user, project, RULES } = await setup();
  const [a, b] = [user(), user()];
  project("shipped", 100, [a, b], { shippedAt: now() - (RULES.fadeMonths + 1) * 30 * 86400 });
  assert.equal(compute().get(a)!.credit, RULES.starter + 25);
});

test("three shipped projects with the same two people is flagged as a closed circle", async () => {
  const { compute, user, project } = await setup();
  const [a, b, c] = [user(), user(), user()];
  for (let i = 0; i < 3; i++) project("shipped", 60, [a, b, c]);
  assert.equal(compute().get(a)!.circle, true);
});

test("teammate suggestions rank proven skills above listed ones", async () => {
  const { suggest, roleSkills } = await import("../lib/match");
  assert.ok(roleSkills("React frontend").has("react"));
  assert.ok(roleSkills("RFID hardware").has("esp32"));
  const people = [
    { id: 1, skills: ["React", "Figma"], credit: 40, shipped: 0, left: 0 }, // listed only
    { id: 2, skills: ["React", "Node"], credit: 160, shipped: 4, left: 0 }, // proven
    { id: 3, skills: ["Python"], credit: 300, shipped: 5, left: 0 },        // no match
    { id: 4, skills: ["React"], credit: 120, shipped: 2, left: 3 },         // proven but quits
  ];
  const s = suggest("React frontend", people);
  // Proven first; someone who quit three projects drops below someone who only listed the skill.
  assert.deepEqual(s.map((x) => x.id), [2, 1, 4]);
  assert.equal(s.find((x) => x.id === 3), undefined);
});
