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
