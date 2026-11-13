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
  const user = (verified = 1, monthsOld = 0) =>
    Number(run("INSERT INTO users (sub, name, verified, onboarded, created_at) VALUES (?,?,?,1,?)", `t:${++n}`, `User ${n}`, verified, now() - monthsOld * 30 * 86400).lastInsertRowid);
  const vouch = (from: number, to: number, at = now()) => run("INSERT INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", from, to, at);
  const project = (status: string, pot: number, team: number[], opts: { left?: number[]; shippedAt?: number } = {}) => {
    const pid = Number(run("INSERT INTO projects (name, pitch, status, lead_id, pot, created_at, shipped_at) VALUES ('P','p',?,?,?,?,?)",
      status, team[0], pot, now(), status === "shipped" ? opts.shippedAt ?? now() : null).lastInsertRowid);
    for (const u of team) run("INSERT INTO members (project_id, user_id) VALUES (?,?)", pid, u);
    for (const u of opts.left ?? []) run("INSERT INTO members (project_id, user_id, status, stake) VALUES (?,?,'left',?)", pid, u, RULES.stake);
    return pid;
  };
  const give = (pid: number, from: number, to: number, pct: number) =>
    run("INSERT INTO allocations (project_id, from_id, to_id, pct) VALUES (?,?,?,?)", pid, from, to, pct);
  return { run, now, compute, shares, RULES, user, project, give, vouch };
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

test("the board's Fits you filter matches a role to the skills a person listed", async () => {
  const { fitFor } = await import("../lib/match");
  assert.deepEqual(fitFor("Search / ML", ["Python", "ML", "FastAPI"]), ["Python", "ML"]);
  assert.deepEqual(fitFor("React frontend", ["React", "Node", "Figma"]), ["React"]);
  assert.deepEqual(fitFor("RFID hardware", ["Flutter", "Firebase"]), []);
});

test("a college email only counts for the college that owns that domain", async () => {
  const { matchCollege, onDomain, isPublicMail, isAcademic, baseDomain } = await import("../lib/domains");
  const colleges = [{ id: 1, domains: "nirmauni.ac.in" }, { id: 2, domains: "iitb.ac.in,iitb.edu" }, { id: 3, domains: "cse.nirmauni.ac.in" }];
  assert.equal(matchCollege("nirmauni.ac.in", colleges)?.id, 1);
  assert.equal(matchCollege("students.nirmauni.ac.in", colleges)?.id, 1, "a subdomain belongs to its college");
  assert.equal(matchCollege("cse.nirmauni.ac.in", colleges)?.id, 3, "the most specific domain wins");
  assert.equal(matchCollege("fakenirmauni.ac.in", colleges), undefined, "a lookalike domain is not the college");
  assert.equal(matchCollege("nirmauni.ac.in.evil.com", colleges), undefined, "a domain that only starts the same is not the college");
  assert.equal(matchCollege("iitb.edu", colleges)?.id, 2);
  assert.ok(!onDomain("xnirmauni.ac.in", "nirmauni.ac.in"));
  assert.ok(isPublicMail("gmail.com") && isPublicMail("yahoo.co.in") && !isPublicMail("nirmauni.ac.in"));
  assert.ok(isAcademic("nirmauni.ac.in") && isAcademic("mit.edu") && isAcademic("unimelb.edu.au") && !isAcademic("somecollege.com"));
  assert.equal(baseDomain("students.mit.edu"), "mit.edu");
  assert.equal(baseDomain("mit.edu"), "mit.edu");
});

test("chat attachments are accepted by what the bytes are, not by their name", async () => {
  const { sniff, cleanName } = await import("../lib/files");
  const B = (s: string | number[]) => Buffer.from(s as never);
  assert.equal(sniff(B([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "a.png")?.mime, "image/jpeg", "a JPEG named .png is still a JPEG");
  assert.equal(sniff(B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "x")?.kind, "image");
  assert.equal(sniff(B("%PDF-1.7 ..."), "notes.pdf")?.mime, "application/pdf");
  assert.equal(sniff(B("MZ\u0090 program"), "notes.pdf"), null, "a program renamed .pdf is refused");
  assert.equal(sniff(B('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "a.svg"), null, "SVG can carry scripts");
  assert.equal(sniff(B("<html><script></script></html>"), "a.html"), null);
  assert.equal(sniff(B("<html><script></script></html>"), "a.txt")?.mime, "text/plain", "text is fine; it is served as plain text");
  assert.equal(sniff(B([0x50, 0x4b, 0x03, 0x04, 0]), "report.docx")?.ext, "docx");
  assert.equal(sniff(B([0x50, 0x4b, 0x03, 0x04, 0]), "archive.zip"), null, "other zip files are refused");
  assert.equal(cleanName("../../etc/passwd<script>.pdf", "pdf"), ".._.._etc_passwd_script_.pdf");
});

test("videos and voice notes are recognised by their bytes too", async () => {
  const { sniff, maxFor } = await import("../lib/files");
  const B = (s: string | number[]) => Buffer.from(s as never);
  const mp4 = Buffer.concat([B([0, 0, 0, 0x18]), B("ftypisom"), B([0, 0, 0, 0])]);
  const mov = Buffer.concat([B([0, 0, 0, 0x14]), B("ftypqt  "), B([0, 0, 0, 0])]);
  const webm = B([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
  assert.equal(sniff(mp4, "clip.mp4")?.mime, "video/mp4");
  assert.equal(sniff(mov, "IMG_0001.MOV")?.mime, "video/quicktime");
  assert.equal(sniff(webm, "x.webm")?.kind, "video");
  assert.equal(sniff(webm, "voice-note.webm", true)?.mime, "audio/webm", "a recording made in the chat is a voice note");
  assert.equal(sniff(mp4, "voice-note.m4a", true)?.kind, "voice");
  assert.equal(sniff(B("OggS\0"), "a.ogg")?.kind, "voice");
  assert.ok(maxFor("video") > maxFor("file") && maxFor("voice") < maxFor("file"));
});

test("call relays: credentials come from Cloudflare or Metered, and calls still work if they are down", async () => {
  const { iceServers, turnProvider } = await import("../lib/calls");
  const realFetch = globalThis.fetch;
  const env = { ...process.env };
  const reset = () => { delete (globalThis as { __ice?: unknown }).__ice; };
  try {
    // Cloudflare: short-lived credentials, port 53 dropped.
    Object.assign(process.env, { CLOUDFLARE_TURN_KEY_ID: "key", CLOUDFLARE_TURN_API_TOKEN: "token" });
    let calls = 0, sent: RequestInit | undefined;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { calls++; sent = init; return new Response(JSON.stringify({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }] }), { status: 201 }); }) as typeof fetch;
    reset();
    assert.equal(turnProvider(), "cloudflare");
    const cf = await iceServers();
    const relay = cf.find((s) => s.username === "u")!;
    assert.ok(([] as string[]).concat(relay.urls).includes("turns:turn.cloudflare.com:443?transport=tcp"));
    assert.ok(!([] as string[]).concat(relay.urls).some((u) => u.includes(":53")), "port 53 is left out");
    assert.equal((sent?.headers as Record<string, string>).Authorization, "Bearer token");
    await iceServers();
    assert.equal(calls, 1, "credentials are reused for an hour");

    // Provider down: STUN only, and it tries again next time.
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    reset();
    const down = await iceServers();
    assert.equal(down.length, 1, "falls back to STUN alone");
    assert.ok(!(globalThis as { __ice?: unknown }).__ice, "a failure is not cached");

    // Metered: only the relay entries are kept.
    delete process.env.CLOUDFLARE_TURN_KEY_ID; delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    Object.assign(process.env, { METERED_DOMAIN: "https://demo.metered.live/", METERED_API_KEY: "k" });
    let url = "";
    globalThis.fetch = (async (u: string) => { url = u; return new Response(JSON.stringify([{ urls: "stun:stun.relay.metered.ca:80" }, { urls: "turn:global.relay.metered.ca:80", username: "m", credential: "p" }])); }) as typeof fetch;
    reset();
    const m = await iceServers();
    assert.equal(url, "https://demo.metered.live/api/v1/turn/credentials?apiKey=k");
    assert.deepEqual(m.slice(1).map((s) => s.urls), ["turn:global.relay.metered.ca:80"]);
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
    reset();
  }
});

test("the service worker rings for calls when Connect is closed and stays quiet when it is on screen", async () => {
  const vm = await import("node:vm");
  const src = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  type N = { title: string; tag: string; closed: boolean; requireInteraction?: boolean; actions?: unknown[]; data?: unknown; close(): void };
  const make = (visible: boolean | null) => {
    const L: Record<string, (e: unknown) => void> = {}, notes: N[] = [], opened: string[] = [], fetched: unknown[] = [];
    const self = {
      location: { origin: "https://c.app" }, addEventListener: (t: string, f: (e: unknown) => void) => (L[t] = f), skipWaiting() {},
      registration: {
        showNotification: async (title: string, o: object) => { notes.push({ title, ...o, closed: false, close() { this.closed = true; } } as N); },
        getNotifications: async ({ tag }: { tag: string }) => notes.filter((n) => n.tag === tag && !n.closed),
      },
      clients: {
        claim() {}, openWindow: async (u: string) => opened.push(u),
        matchAll: async () => (visible === null ? [] : [{ url: "https://c.app/", visibilityState: visible ? "visible" : "hidden", focus: async () => {}, navigate: async (u: string) => opened.push(u) }]),
      },
    };
    vm.runInContext(src, vm.createContext({ self, URL, JSON, fetch: async (_u: string, o: { body: string }) => fetched.push(JSON.parse(o.body)) }));
    const fire = async (t: string, ev: object) => { let p: unknown; L[t]({ ...ev, waitUntil: (x: unknown) => (p = x) }); await p; };
    return { notes, opened, fetched, push: (d: object) => fire("push", { data: { json: () => d } }), click: (n: N, action = "") => fire("notificationclick", { notification: n, action }) };
  };
  const call = { type: "call", id: 7, video: true, from: { id: 4, name: "Tanvi" } };
  let t = make(null);
  await t.push(call);
  assert.ok(t.notes[0].requireInteraction && t.notes[0].actions?.length === 2, "closed app: a call notification with Answer and Decline");
  await t.click(t.notes[0], "answer");
  assert.equal(t.opened[0], "/messages/4?answer=7");
  t = make(null); await t.push(call); await t.click(t.notes[0], "decline");
  assert.deepEqual(t.fetched[0], { action: "decline", id: 7 });
  t = make(null); await t.push(call); await t.push({ type: "call-end", id: 7, video: true, missed: true, from: call.from });
  assert.ok(t.notes[0].closed && t.notes[1].title === "Missed video call");
  t = make(true); await t.push(call); await t.push({ type: "msg", from: call.from, text: "hi" });
  assert.equal(t.notes.length, 0, "on screen: the page handles it");
  t = make(false); await t.push({ type: "msg", from: call.from, text: "hi" });
  assert.equal(t.notes[0].title, "Tanvi");
});

/* ---------- rating redesign: credibility, vouch limits, rings ---------- */

/* The credit rules exactly as they were before the redesign. Used to prove that nobody's credit moved. */
async function creditBefore(): Promise<Map<number, number>> {
  const { all, now } = await import("../lib/db");
  const { shares, RULES } = await import("../lib/credit");
  const sum = new Map<number, number[]>(), stats = new Map<number, number>();
  for (const u of all("SELECT id, verified, role FROM users")) sum.set(u.id, u.verified && u.role === "student" ? [RULES.starter] : []);
  const members = all("SELECT * FROM members"), allocs = all("SELECT * FROM allocations");
  const shippedWith = new Map<number, Set<number>>();
  for (const p of all("SELECT * FROM projects")) {
    const team = members.filter((m) => m.project_id === p.id);
    const active = team.filter((m) => m.status === "active").map((m) => m.user_id as number);
    for (const m of team) {
      const l = sum.get(m.user_id)!;
      if (m.status === "left") { if (m.stake) l.push(-m.stake); }
      else if (p.status === "dropped") { if (m.user_id === p.lead_id) l.push(-RULES.stake); }
      else if (p.status !== "shipped" && m.stake) l.push(-m.stake);
    }
    if (p.status !== "shipped") continue;
    const sh = shares(active, allocs.filter((a) => a.project_id === p.id));
    const faded = (p.shipped_at ?? 0) < now() - RULES.fadeMonths * 30 * 86400;
    for (const id of active) {
      sum.get(id)!.push(Math.round(p.pot * (sh.get(id)! / 100) * (active.length === 1 ? RULES.soloFactor : 1) * (faded ? 0.5 : 1)));
      if (!shippedWith.has(id)) shippedWith.set(id, new Set());
      for (const o of active) if (o !== id) shippedWith.get(id)!.add(o);
    }
  }
  for (const r of all("SELECT user_id FROM requests WHERE status='pending'")) sum.get(r.user_id)?.push(-RULES.stake);
  for (const [id, l] of sum) stats.set(id, Math.max(0, l.reduce((a, b) => a + b, 0)));
  const vouches = all("SELECT * FROM vouches"), pair = new Set(vouches.map((v) => `${v.from_id}>${v.to_id}`));
  for (const v of vouches) {
    if (!sum.has(v.to_id) || !sum.has(v.from_id) || !shippedWith.get(v.to_id)?.has(v.from_id)) continue;
    let n = RULES.vouch * Math.min(1, stats.get(v.from_id)! / RULES.fullWeightAt);
    if (pair.has(`${v.to_id}>${v.from_id}`)) n /= 2;
    sum.get(v.to_id)!.push(Math.max(1, Math.round(n)));
  }
  return new Map([...sum].map(([id, l]) => [id, Math.max(0, l.reduce((a, b) => a + b, 0))]));
}

test("carry-over: the sample college has exactly the credit it had before the redesign", async () => {
  await setup();
  await import("../scripts/seed");
  const { compute } = await import("../lib/credit");
  const before = await creditBefore(), after = compute();
  assert.ok(before.size >= 10);
  for (const [id, n] of before) assert.equal(after.get(id)!.credit, n, `user ${id}`);
  assert.ok([...before.values()].some((n) => n > 100), "the sample data has real credit in it");
});

test("a lone 95% split is pulled to the middle of what the others gave", async () => {
  const { shares } = await setup();
  const ids = [1, 2, 3, 4];
  const even = (from: number) => ids.filter((x) => x !== from).map((to) => ({ from_id: from, to_id: to, pct: to === ids.filter((x) => x !== from)[0] ? 34 : 33 }));
  // 2 is 1's friend and gives 1 almost everything; 3 and 4 split evenly.
  const allocs = [...even(1), { from_id: 2, to_id: 1, pct: 95 }, { from_id: 2, to_id: 3, pct: 3 }, { from_id: 2, to_id: 4, pct: 2 }, ...even(3), ...even(4)];
  const sh = shares(ids, allocs);
  assert.ok(sh.get(1)! < 30, `one generous friend cannot lift a share: got ${sh.get(1)}`);
});

test("credibility starts in the middle and moves with what a person does, never with what they type", async () => {
  const { run, compute, user, project } = await setup();
  const [a, b, c, quitter] = [user(), user(), user(), user()];
  const fresh = compute().get(a)!.cred.score;
  assert.equal(fresh, 53, "a new verified student starts in the middle");
  project("shipped", 100, [a, b, c], { left: [quitter] });
  const S = compute();
  assert.ok(S.get(a)!.cred.score > fresh, "finishing raises it");
  assert.ok(S.get(quitter)!.cred.score < fresh, "leaving lowers it");
  // Everything a person can type about themselves.
  const snap = () => { const s = compute().get(quitter)!; return [s.credit, s.earned, s.cred.score].join(); };
  const was = snap();
  run("UPDATE users SET skills='React, Rust, ML, PCB design', about='10x founder', github='https://github.com/torvalds', linkedin='https://linkedin.com/in/x', branch='CSE' WHERE id=?", quitter);
  for (let i = 0; i < 10; i++) run("INSERT INTO claims (user_id, text) VALUES (?,?)", quitter, "Won everything");
  run("UPDATE members SET did='Built all of it', role='Chief architect' WHERE user_id=?", quitter);
  assert.equal(snap(), was);
});

test("account age and an upheld report move credibility; a dismissed report does not", async () => {
  const { run, now, compute, user } = await setup();
  const [young, old, reported, cleared] = [user(), user(1, 12), user(1, 12), user(1, 12)];
  run("INSERT INTO reports (by_id, kind, target_id, reason, open, result, created_at) VALUES (?,?,?,?,0,'upheld',?)", old, "user", reported, "x", now());
  run("INSERT INTO reports (by_id, kind, target_id, reason, open, result, created_at) VALUES (?,?,?,?,0,'dismissed',?)", old, "user", cleared, "x", now());
  const S = compute(), RULES = (await import("../lib/rules")).RULES;
  assert.equal(S.get(old)!.cred.score - S.get(young)!.cred.score, 10);
  assert.equal(S.get(old)!.cred.score - S.get(reported)!.cred.score, RULES.cred.reportPenalty);
  assert.equal(S.get(cleared)!.cred.score, S.get(old)!.cred.score);
});

test("a vouch weighs as much as the voucher can be trusted, and only the five strongest count", async () => {
  const { run, now, compute, user, project, vouch, RULES } = await setup();
  const star = user(), mates = [1, 2, 3, 4, 5, 6, 7].map(() => user(1, 12));
  for (const m of mates) project("shipped", 60, [star, m]);
  const before = compute().get(star)!.credit;
  const flaky = mates[0];
  for (let i = 0; i < 4; i++) project("building", 0, [star], { left: [flaky] }); // flaky keeps leaving projects
  for (let i = 0; i < 2; i++) run("INSERT INTO reports (by_id, kind, target_id, reason, open, result, created_at) VALUES (?,?,?,?,0,'upheld',?)", star, "user", flaky, "x", now());
  const S = compute();
  assert.ok(S.get(flaky)!.cred.score < S.get(mates[1])!.cred.score);
  vouch(flaky, star);
  const fromFlaky = compute().get(star)!.credit - before;
  for (const m of mates.slice(1)) vouch(m, star);
  const all = compute().get(star)!.ledger.filter((l) => l.what.startsWith("Vouch")).map((l) => l.n);
  assert.equal(all.length, RULES.vouchesCounted, "seven people vouched, five count");
  assert.ok(Math.min(...all) > fromFlaky, "the weakest vouch is the one left out");
  assert.ok(all.every((n) => n <= RULES.vouch));
});

test("a closed vouch ring is flagged and its vouches count a quarter", async () => {
  const { compute, user, project, vouch } = await setup();
  const ring = [user(1, 12), user(1, 12), user(1, 12)], open = [user(1, 12), user(1, 12), user(1, 12)], outsider = user(1, 12);
  project("shipped", 100, ring);
  project("shipped", 100, open);
  project("shipped", 60, [open[0], outsider]); // one of the open group has shipped with someone else
  for (const g of [ring, open]) for (const a of g) for (const b of g) if (a !== b) vouch(a, b);
  const S = compute();
  const vouchCredit = (id: number) => S.get(id)!.ledger.filter((l) => l.what.startsWith("Vouch")).reduce((a, l) => a + l.n, 0);
  for (const id of ring) assert.equal(S.get(id)!.ring, true);
  for (const id of open) assert.equal(S.get(id)!.ring, false);
  assert.ok(vouchCredit(ring[1]) < vouchCredit(open[1]), `ring ${vouchCredit(ring[1])} vs open ${vouchCredit(open[1])}`);
  assert.ok(S.get(ring[1])!.cred.score < S.get(open[1])!.cred.score);
});

test("reviews that match the outcome earn a little and build credibility; ones that miss lose it", async () => {
  const { run, now, compute, user, RULES } = await setup();
  const [good, bad] = [user(), user()];
  const base = compute().get(good)!.cred.score;
  for (let i = 0; i < 8; i++) {
    run("INSERT INTO review_log (project_id, reviewer_id, verdict, outcome, created_at) VALUES (?,?,?,?,?)", 100 + i, good, 60, 60, now());
    run("INSERT INTO review_log (project_id, reviewer_id, verdict, outcome, created_at) VALUES (?,?,?,?,?)", 100 + i, bad, 100, 60, now());
  }
  const S = compute();
  assert.equal(S.get(good)!.earned, RULES.starter + RULES.reviewRewardCap, "capped per 30 days");
  assert.equal(S.get(bad)!.earned, RULES.starter);
  assert.ok(S.get(good)!.cred.score > base && S.get(bad)!.cred.score < base);
});

test("a held stake lowers what you can spend, not what you have earned", async () => {
  const { run, compute, user, project, RULES } = await setup();
  const [lead, joiner] = [user(), user()];
  const pid = project("building", 0, [lead]);
  run("INSERT INTO members (project_id, user_id, stake) VALUES (?,?,?)", pid, joiner, RULES.stake);
  const s = compute().get(joiner)!;
  assert.equal(s.credit, RULES.starter - RULES.stake);
  assert.equal(s.earned, RULES.starter);
});

/* ---------- rating redesign: competency per skill ---------- */

async function skillKit() {
  const k = await setup();
  const { competency, rate, canon, parseSkills } = await import("../lib/skills");
  const tick = (pid: number, to: number, skill: string, by: number) => k.run("INSERT OR IGNORE INTO member_skills (project_id, user_id, skill, by_id) VALUES (?,?,?,?)", pid, to, skill, by);
  /* A shipped team project where every teammate ticks `skill` for every other. */
  const shipWith = (team: number[], skill: string, pot = 100, shippedAt?: number) => {
    const pid = k.project("shipped", pot, team, { shippedAt });
    for (const a of team) for (const b of team) if (a !== b) tick(pid, a, skill, b);
    return pid;
  };
  const skill = (id: number, name: string) => competency(k.compute()).get(id)?.get(name);
  return { ...k, competency, rate, canon, parseSkills, tick, shipWith, skill };
}

test("skill names: different spellings are one skill", async () => {
  const { canon, parseSkills } = await skillKit();
  assert.equal(canon(" NextJS "), "next.js");
  assert.equal(canon("React.js"), canon("react"));
  assert.deepEqual(parseSkills("React, react.js, Node,  , PCB"), ["react", "node", "pcb design"]);
});

test("the skill formula starts at the prior and needs weight to move", async () => {
  const { rate, RULES } = await skillKit();
  const K = (await import("../lib/rules")).RULES.skill;
  assert.equal(rate([]).score, K.prior);
  assert.equal(rate([]).conf, 0);
  const one = rate([{ q: 1, w: 1 }]);
  assert.ok(Math.abs(one.score - (100 * (K.k * 0.3 + 1)) / (K.k + 1)) < 1e-9);
  assert.ok(rate([{ q: 1, w: 0.2 }]).score < one.score, "less trusted evidence moves the score less");
  assert.ok(rate([{ q: 0.1, w: 3 }]).score < K.prior, "poor work lowers a score");
  assert.ok(RULES.live > RULES.demo);
});

test("typing a skill gives no score; teammates confirming it does", async () => {
  const { run, user, project, tick, skill, competency, compute } = await skillKit();
  const [a, b, c] = [user(1, 12), user(1, 12), user(1, 12)];
  const pid = project("shipped", 100, [a, b, c]);
  run("INSERT INTO project_skills (project_id, skill) VALUES (?, 'react')", pid);
  run("UPDATE users SET skills='React, Rust, ML' WHERE id=?", a);
  assert.equal(competency(compute()).get(a), undefined, "a listed skill and a project skill list are worth nothing");
  tick(pid, a, "react", a);
  assert.equal(skill(a, "react"), undefined, "ticking your own skill does nothing");
  tick(pid, a, "react", b);
  const s = skill(a, "react")!;
  assert.ok(s.score > 30 && s.why === "based on 1 shipped project");
  assert.equal(skill(a, "rust"), undefined);
});

test("a skill needs half the teammates, and outsiders cannot tick it", async () => {
  const { user, project, tick, skill } = await skillKit();
  const team = [user(), user(), user(), user(), user()], outsider = user();
  const pid = project("shipped", 100, team);
  tick(pid, team[0], "react", team[1]);
  tick(pid, team[0], "react", outsider);
  assert.equal(skill(team[0], "react"), undefined, "one of four teammates is not half");
  tick(pid, team[0], "react", team[2]);
  assert.ok(skill(team[0], "react"));
});

test("one project cannot make an expert; more projects raise the score and the confidence", async () => {
  const { user, shipWith, skill } = await skillKit();
  const [a, b, c] = [user(1, 12), user(1, 12), user(1, 12)];
  shipWith([a, b, c], "react");
  const one = skill(a, "react")!;
  assert.ok(one.score < 50, `one project gave ${one.score}`);
  assert.equal(one.band, "low");
  shipWith([a, b, c], "react"); shipWith([a, b, c], "react"); shipWith([a, b, c], "react");
  const four = skill(a, "react")!;
  assert.ok(four.score > one.score && four.conf > one.conf);
  assert.ok(four.score < 90, "even four live projects do not reach the top");
  assert.equal(four.why, "based on 4 shipped projects");
});

test("old work counts half after 18 months, demo work counts less than live, and a bigger share counts more", async () => {
  const { now, user, shipWith, skill, give, RULES } = await skillKit();
  const K = (await import("../lib/rules")).RULES.skill;
  const [a, b, c, d] = [user(1, 12), user(1, 12), user(1, 12), user(1, 12)];
  shipWith([a, b], "react");
  shipWith([a, b], "node", 100, now() - K.halfLifeMonths * 30 * 86400);
  shipWith([a, b], "figma", RULES.demo);
  assert.ok(Math.abs(skill(a, "node")!.items[0].w / skill(a, "react")!.items[0].w - 0.5) < 0.01);
  assert.ok(skill(a, "figma")!.score < skill(a, "react")!.score);
  const pid = shipWith([b, c, d], "python");
  give(pid, b, c, 80); give(pid, b, d, 20); give(pid, d, c, 80); give(pid, d, b, 20); give(pid, c, b, 50); give(pid, c, d, 50);
  assert.ok(skill(c, "python")!.score > skill(d, "python")!.score, "the person teammates say did most scores higher");
});

test("a skill signed by people who cannot be trusted counts for less", async () => {
  const { run, now, user, shipWith, project, skill } = await skillKit();
  const [a, good, b, shady] = [user(1, 12), user(1, 12), user(1, 12), user(1, 12)];
  for (let i = 0; i < 3; i++) run("INSERT INTO reports (by_id, kind, target_id, reason, open, result, created_at) VALUES (?,?,?,?,0,'upheld',?)", a, "user", shady, "x", now());
  for (let i = 0; i < 4; i++) project("building", 0, [a], { left: [shady] });
  shipWith([a, good], "react");
  shipWith([b, shady], "react");
  assert.ok(skill(b, "react")!.score < skill(a, "react")!.score);
});

test("a solo project's skills count only when a reviewer or admin ticks them, and at half weight", async () => {
  const { run, now, user, project, tick, skill, shipWith } = await skillKit();
  const [solo, reviewer, friend, mate] = [user(1, 12), user(1, 12), user(1, 12), user(1, 12)];
  const pid = project("shipped", 100, [solo]);
  tick(pid, solo, "rust", friend);
  assert.equal(skill(solo, "rust"), undefined, "a friend who did not review it cannot sign");
  run("INSERT INTO review_log (project_id, reviewer_id, verdict, outcome, created_at) VALUES (?,?,100,100,?)", pid, reviewer, now());
  tick(pid, solo, "rust", reviewer);
  shipWith([mate, friend], "rust");
  assert.ok(skill(solo, "rust")!.score < skill(mate, "rust")!.score);
  assert.equal(skill(solo, "rust")!.why, "based on 1 solo project");
});

/* ---------- rating redesign: evidence tiers, reviewers, live links, split flags ---------- */

test("outside evidence counts only once verified, and for less than work Connect saw happen", async () => {
  const { run, now, user, shipWith, skill, compute } = await skillKit();
  const [a, b, c, admin] = [user(1, 12), user(1, 12), user(1, 12), user(1, 12)];
  run("UPDATE users SET admin=1 WHERE id=?", admin);
  const ev = (who: number, status: string, kind = "hackathon", value = "won", skills = "python") =>
    Number(run("INSERT INTO evidence (user_id, kind, title, skills, value, status, method, decided_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", who, kind, "Hack", skills, value, status, "admin", admin, now()).lastInsertRowid);
  const cred = (id: number) => compute().get(id)!.cred.score, base = cred(a);
  ev(a, "pending");
  assert.equal(skill(a, "python"), undefined, "waiting items count for nothing");
  assert.equal(cred(a), base);
  ev(a, "verified");
  const tierB = skill(a, "python")!;
  assert.equal(tierB.why, "based on 1 hackathon");
  assert.ok(cred(a) > base, "evidence that checked out builds credibility");
  // The same skill from a live shipped project, signed by teammates, moves the score more.
  shipWith([b, c], "python");
  assert.ok(skill(b, "python")!.score > tierB.score && skill(b, "python")!.conf > tierB.conf);
  ev(c, "rejected", "internship", "", "rust");
  assert.equal(skill(c, "rust"), undefined);
  assert.ok(cred(c) < cred(b), "a rejected item costs credibility");
  // Marks are not evidence of any kind.
  ev(a, "verified", "cgpa", "9.8", "data structures");
  assert.equal(skill(a, "data structures"), undefined, "a CGPA row is ignored even if one were stored");
});

test("reviewers come from outside the team's network, and trusted people are picked more often", async () => {
  const { all } = await import("../lib/db");
  const { user, project, compute } = await setup();
  const { eligibleReviewers, teamTies, pickWeighted } = await import("../lib/reviewers");
  const [lead, mate, friend, poor, far1, far2, helper] = [user(), user(), user(), user(), user(), user(), user()];
  project("shipped", 100, [lead, friend]);   // friend has shipped with the lead
  project("shipped", 100, [far1, far2]);     // far1 and far2 have credit and no tie to the team
  project("shipped", 100, [friend, helper]); // so friend has enough credit, and so does helper
  const pid = project("review", 0, [lead, mate]);
  const S = compute();
  const team = all("SELECT user_id FROM members WHERE project_id=?", pid).map((r) => r.user_id);
  const ok = eligibleReviewers(all("SELECT * FROM users"), team, teamTies(all("SELECT project_id, user_id FROM members")), S).sort();
  assert.deepEqual(ok, [far1, far2, helper].sort(), "not the team, not their past teammates, not people without credit");
  assert.ok(!ok.includes(friend) && !ok.includes(poor));
  // With a fixed "random" number the heavier person is taken first; nobody is picked twice.
  assert.deepEqual(pickWeighted([1, 2, 3], (id) => (id === 3 ? 10 : 0.1), 2, () => 0.5)[0], 3);
  assert.equal(new Set(pickWeighted([1, 2, 3, 4, 5], () => 1, 4)).size, 4);
  assert.equal(pickWeighted([1, 2], () => 1, 4).length, 2);
});

test("two matching reviews decide; a disagreement waits for a third and the middle verdict wins; an admin settles it", async () => {
  await setup();
  const { verdictOf } = await import("../lib/reviewers");
  assert.equal(verdictOf([{ verdict: 100 }]), null);
  assert.equal(verdictOf([{ verdict: 100 }, { verdict: 100 }]), 100);
  assert.equal(verdictOf([{ verdict: 100 }, { verdict: 60 }]), null);
  assert.equal(verdictOf([{ verdict: 100 }, { verdict: 60 }, { verdict: 60 }]), 60);
  assert.equal(verdictOf([{ verdict: 100 }, { verdict: 0 }, { verdict: 60 }]), 60, "one harsh and one soft reviewer are both outvoted");
  assert.equal(verdictOf([{ verdict: 100 }, { verdict: 100 }, { verdict: 0, admin: 1 }]), 0);
  assert.equal(verdictOf([{ verdict: 60, admin: 1 }]), 60);
});

test("the live check only ever opens public https links", async () => {
  const { isPublicAddress, liveUrl, checkLive } = await import("../lib/live");
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "not-an-ip"])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1/", "https://[::1]/", "https://user:pw@example.com", "https://example.com:8443/", "https://intranet", "ftp://example.com", "https://db.internal/"])
    assert.equal(liveUrl(u), null, u);
  assert.ok(liveUrl("https://busping.example.com/map"));
  assert.equal((await checkLive("https://127.0.0.1/admin")).ok, false);
});

test("a big share with nothing on the record is flagged for an admin, and changes no numbers", async () => {
  const { run, now, user, project, give, compute } = await setup();
  const { splitFlags } = await import("../lib/reviewers");
  const [a, b, c, d] = [user(), user(), user(), user()];
  const pid = project("shipped", 100, [a, b, c, d]);
  run("UPDATE projects SET college_id=1 WHERE id=?", pid);
  run("UPDATE members SET did='Did things' WHERE project_id=? AND user_id<>?", pid, d);
  for (const u of [a, b, c]) run("INSERT INTO updates (project_id, user_id, kind, text, created_at) VALUES (?,?,'event','Milestone done: x',?)", pid, u, now());
  // a, b and c all hand most of their split to d, who did nothing anyone can see.
  for (const from of [a, b, c]) for (const to of [a, b, c, d]) if (to !== from) give(pid, from, to, to === d ? 80 : 10);
  give(pid, d, a, 34); give(pid, d, b, 33); give(pid, d, c, 33);
  const before = compute().get(d)!.credit;
  const flags = splitFlags(1);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].user_id, d);
  assert.equal(compute().get(d)!.credit, before);
  run("UPDATE members SET did='Built the backend' WHERE project_id=? AND user_id=?", pid, d);
  run("INSERT INTO updates (project_id, user_id, kind, text, created_at) VALUES (?,?,'post','Shipped the API',?)", pid, d, now());
  assert.equal(splitFlags(1).length, 0, "the flag clears once the record shows their work");
});

/* ---------- rating redesign: relevance for a role ---------- */

test("relevance: confirmed skills rank people, listed skills never do, and every suggestion explains itself", async () => {
  const { run, user, shipWith, project, compute, competency } = await skillKit();
  const { rank, needsFor, needsFromList, fit, availability } = await import("../lib/relevance");
  const [pro, mate, once, mate2, lister, quitter, mate3, busy, mate4] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => user(1, 12));
  for (let i = 0; i < 3; i++) shipWith([pro, mate], "react");
  shipWith([once, mate2], "react");
  run("UPDATE users SET skills='React, Next.js, TypeScript, Node, GraphQL' WHERE id=?", lister);
  shipWith([quitter, mate3], "react"); shipWith([quitter, mate3], "react"); shipWith([quitter, mate3], "react");
  for (let i = 0; i < 4; i++) project("building", 0, [mate3], { left: [quitter] });
  for (let i = 0; i < 3; i++) shipWith([busy, mate4], "react");
  for (let i = 0; i < 5; i++) project("building", 0, [busy]);
  const S = compute(), K = competency(S);
  const person = (id: number, extra = {}) => {
    const st = S.get(id)!;
    return { id, skills: K.get(id), listed: id === lister ? ["React", "Next.js", "TypeScript", "Node", "GraphQL"] : [], finishRate: st.cred.finishRate,
      finished: st.shipped, ended: st.shipped + st.left, open: true, load: st.building, ...extra };
  };
  const people = [lister, quitter, once, busy, pro].map((id) => person(id));
  const needs = needsFor("React frontend", needsFromList(["React", "Node"]));
  const { ranked, fresh } = rank(needs, "React frontend", people);
  assert.equal(ranked[0].id, pro, "three confirmed projects and a clean record come first");
  assert.ok(ranked.findIndex((x) => x.id === once) > 0);
  assert.ok(!ranked.some((x) => x.id === lister), "someone who only listed five skills is not ranked at all");
  assert.deepEqual(fresh.map((x) => x.id), [lister], "they are shown apart, as new with no proof");
  const at = (id: number) => ranked.find((x) => x.id === id)!.score;
  assert.ok(at(quitter) < at(pro), "leaving projects lowers fit");
  assert.ok(at(busy) < at(pro), "someone on five projects ranks lower than the same record with free time");
  for (const f of ranked) assert.match(f.reason, /^Fits: React \d+, from \d shipped projects?.* · finished \d+ of \d+ joined/);
  // The small parts of the formula.
  assert.equal(availability(true, 2), 1);
  assert.ok(availability(true, 3) < 1 && availability(false, 0) < 1 && availability(true, 50) > 0);
  const plain = fit(needs, person(pro))!, known = fit(needs, person(pro, { shippedWith: "with Riya before" }))!;
  assert.ok(known.score > plain.score && known.reason.includes("shipped with Riya before"));
  // A role with no listed skills falls back to its title.
  const guessed = rank(needsFor("React frontend", []), "React frontend", people);
  assert.equal(guessed.ranked[0].id, pro);
  assert.deepEqual(guessed.fresh.map((x) => x.id), [lister]);
});

test("the Fits you filter uses a role's listed skills when it has them", async () => {
  const { fitsMe, needsFor, needsFromList } = await import("../lib/relevance");
  assert.deepEqual(fitsMe(needsFor("Wizard", needsFromList(["NextJS", "Figma"])), "Wizard", ["Next.js", "Python"]), ["Next.js"]);
  assert.deepEqual(fitsMe(needsFor("React frontend", []), "React frontend", ["React", "Python"]), ["React"]);
});
