/* A small invented community for the name tests (scripts/names.test.ts, scripts/backfill-names.test.ts). It does, through
   the real actions and routes, every one of the 32 things that leave a line naming someone, and reads those lines back
   through the pages and APIs people use. Every name here is made up. Throwaway database only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "connect-names-")), "test.db");
// Nothing may leave the test: no email, push, call relay or AI.
for (const k of ["SMTP_URL", "RESEND_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CLOUDFLARE_TURN_KEY_ID", "METERED_DOMAIN", "TURN_URLS", "GEMINI_API_KEY", "ADMIN_EMAILS", "COLLEGE_EMAIL_DOMAIN", "APP_URL"])
  delete process.env[k];

/* The little of Next.js that actions and pages need outside a request. */
const req = createRequire(path.join(process.cwd(), "package.json"));
const jar = new Map<string, string>();
Object.assign(req("next/headers"), {
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
});
Object.assign(req("next/cache"), { revalidatePath: () => {} });
Object.assign(req("next/server"), { after: () => {} });
req.extensions[".css"] = () => {};

export const CAST = {
  lead: "Avel Quistmere", joiner: "Bryn Tollivane", removed: "Cato Fenwimple", mate: "Dessa Morvaine",
  alum: "Eero Blixworth", newcomer: "Fia Gundrelle", returning: "Galo Pennywhistle",
  admin: "Hessa Underbough", watcher: "Ivo Marrowgate",
};
export type Who = keyof typeof CAST;
/* Everyone who is named in somebody else's line. */
export const ACTORS: Who[] = ["lead", "joiner", "removed", "mate", "alum", "newcomer", "returning"];

type Where = "updates" | "team" | Who; // a person means that person's inbox
/* The 32 lines, with the names as they should read now. */
export const LINES: [by: Who, where: Where, text: (name: string) => string][] = [
  ["lead", "updates", (n) => `${n} posted the project`],
  ["lead", "updates", (n) => `${n} made the project public`],
  ["joiner", "updates", (n) => `${n} joined as Builder`],
  ["alum", "updates", (n) => `Funded by ${n}`],

  ["joiner", "team", (n) => `${n} joined the team as Builder`],
  ["removed", "team", (n) => `${n} was removed by the team`],
  ["mate", "team", (n) => `${n} pinned a message`],
  ["lead", "team", (n) => `${n} started a team video call`],
  ["joiner", "team", (n) => `${n} left the team`],

  ["returning", "admin", (n) => `${n} says they are an alum of Testfield. Approve them if that is true.`],
  ["newcomer", "admin", (n) => `${n} asked to be verified as a member of Testfield`],
  ["lead", "admin", (n) => `${n} added evidence to check: Harbour Hack`],
  ["lead", "admin", (n) => `${n} asked to start a club: Kite Club`],
  ["lead", "joiner", (n) => `${n} invited you to apply for Builder on Kite`],
  ["lead", "joiner", (n) => `${n} vouched for you`],
  ["lead", "joiner", (n) => `${n} says you were on their team at Harbour Hack. Confirm it if that is true.`],
  ["lead", "joiner", (n) => `${n} sent you 10 credit to use`],
  ["lead", "joiner", (n) => `${n} invited you to join Kite Club`],
  ["lead", "joiner", (n) => `Kite Club was deleted by ${n}`],
  ["lead", "joiner", (n) => `Missed voice call from ${n}`],
  ["lead", "removed", (n) => `${n} invited you to apply for Tester on Kite`],
  ["joiner", "lead", (n) => `${n} asked to join Kite as Builder: "I can weld"`],
  ["alum", "lead", (n) => `${n} is funding Kite`],
  ["alum", "lead", (n) => `${n} marked a payment as sent: Prototype`],
  ["removed", "lead", (n) => `${n} asked about Kite: Does it fly in rain?`],
  ["removed", "lead", (n) => `${n} asked to join Kite Club`],
  ["joiner", "lead", (n) => `${n} joined Kite Club`],
  ["joiner", "watcher", (n) => `${n} applied to do “Draw a map”`],
  ["lead", "watcher", (n) => `${n} sent you a photo`],
  ["mate", "watcher", (n) => `${n} sent you a message`],
  ["alum", "mate", (n) => `${n} marked the payment for “Fix the rig” as sent`],
  ["lead", "mate", (n) => `${n} started a team video call in Kite`],
];

const DEVICE = { lead: "lead-device-0001", mate: "mate-device-0001" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
/* Never reused, because the actions' rate limits are kept per person id for as long as the process runs. */
let lastId = 0;
/* Five seconds pass before each thing someone does, as they would in life, so each line's record has its own second. */
let passed = 0;
const clock = Date.now.bind(Date);
Date.now = () => clock() + passed * 1000;

/* A page by its path under app/, in whichever route group it lives. */
async function page(rel: string) {
  const app = path.join(process.cwd(), "app");
  const file = ["", ...fs.readdirSync(app).filter((d) => /^\(.+\)$/.test(d))].map((d) => path.join(app, d, rel)).find((f) => fs.existsSync(f));
  assert.ok(file, `no page at ${rel}`);
  const m = await import(file);
  return m.default.default ?? m.default;
}

async function html(node: ReactNode) {
  const { prerender } = await import("react-dom/static");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const { prelude } = await prerender(createElement(AppRouterContext.Provider, { value: router as never }, node));
  return new Response(prelude as unknown as ReadableStream).text();
}
const textIn = (markup: string) => markup.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/* Builds the community and makes everything happen. `anonymous` lists who already was anonymous when it happened. */
export async function world(opts: { anonymous?: Who[] } = {}) {
  const { all, get, run, now, TABLES } = await import("../lib/db");
  const { sessionToken } = await import("../lib/auth");
  const { bridge } = await import("../lib/bridge");
  const { setAnonymous } = await import("../lib/identity");
  const A = await import("../app/actions");
  const Chat = await import("../app/chat-actions");
  const Team = await import("../app/team-actions");
  const { setAnonymousMode } = await import("../app/identity-actions");

  for (const t of TABLES) run(`DELETE FROM ${t}`);
  const old = now() - 400 * 86400;
  const college = Number(run("INSERT INTO colleges (slug, name, domains, status, created_at) VALUES ('testfield','Testfield','testfield.example','active',?)", old).lastInsertRowid);
  const id = {} as Record<Who, number>;
  for (const who of Object.keys(CAST) as Who[]) {
    id[who] = ++lastId;
    run("INSERT INTO users (id, sub, name, email, role, admin, verified, onboarded, college_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id[who], `t:${id[who]}`, CAST[who], `person${id[who]}@mail.example`, who === "alum" ? "alum" : "student", who === "admin" ? 1 : 0,
      who === "newcomer" || who === "returning" ? 0 : 1, who === "returning" ? 0 : 1, who === "newcomer" || who === "returning" ? null : college, old);
  }
  for (const who of opts.anonymous ?? []) setAnonymous(get("SELECT * FROM users WHERE id=?", id[who]), true);

  const as = (who: Who) => {
    passed += 5;
    jar.set("sid", sessionToken(id[who], get("SELECT session_v FROM users WHERE id=?", id[who]).session_v ?? 0));
  };
  async function act(who: Who, action: (fd: FormData) => Promise<unknown>, fields: Record<string, string | number | boolean> = {}) {
    as(who);
    const out = await bridge(action, fields);
    assert.ok(out.ok, `${who}, ${action.name}: ${out.ok ? "" : out.error}`);
  }
  async function post(who: Who, route: { POST: (r: Request) => Promise<Response> }, body: object | FormData) {
    as(who);
    const form = body instanceof FormData;
    const res = await route.POST(new Request("http://localhost:4000/api/test", {
      method: "POST", body: form ? body : JSON.stringify(body), headers: { origin: "http://localhost:4000", ...(form ? {} : { "content-type": "application/json" }) },
    }));
    const out = await res.json();
    assert.equal(res.status, 200, `${who}: ${JSON.stringify(out)}`);
    return out;
  }

  await act("returning", A.saveProfile, { role: "alum", college, branch: "CSE", grad_year: 2016, terms: true });
  await act("newcomer", A.askCollegeAdmin, { college });

  // Work they shipped earlier, so vouching and gifts are allowed.
  const shipped = Number(run("INSERT INTO projects (name, pitch, status, lead_id, pot, college_id, created_at, shipped_at) VALUES ('Lantern','A lamp','shipped',?,100,?,?,?)", id.lead, college, old, now() - 86400).lastInsertRowid);
  for (const who of ["lead", "joiner"] as const) run("INSERT INTO members (project_id, user_id) VALUES (?,?)", shipped, id[who]);

  await act("lead", A.createProject, { name: "Kite", pitch: "A kite that maps wind", milestones: "Fly it", roles: "Builder\nTester\nWelder", visibility: "private" });
  const pid = get("SELECT id FROM projects WHERE name='Kite'").id as number;
  await act("lead", A.setVisibility, { id: pid, visibility: "public" });
  const role = (title: string) => get("SELECT id FROM roles WHERE project_id=? AND title=?", pid, title).id as number;
  await act("lead", A.inviteToRole, { role: role("Builder"), to: id.joiner });
  await act("lead", Chat.inviteToProject, { role: role("Tester"), to: id.removed });
  for (const [who, title, note] of [["joiner", "Builder", "I can weld"], ["removed", "Tester", ""], ["mate", "Welder", ""]] as const) {
    await act(who, A.requestJoin, { role: role(title), note });
    await act("lead", A.answerRequest, { request: get("SELECT id FROM requests WHERE project_id=? AND user_id=?", pid, id[who]).id, answer: "accept" });
  }
  await act("lead", A.voteGone, { id: pid, target: id.removed });
  await act("mate", A.voteGone, { id: pid, target: id.removed });
  await act("lead", A.vouch, { to: id.joiner });
  await act("lead", A.submitEvidence, { kind: "hackathon", title: "Harbour Hack", url: "https://proof.example/harbour", skills: "python", teammate: id.joiner });

  const call = Number(run("INSERT INTO calls (alum_id, title, about, amount, min_credit, college_id) VALUES (?,'Parts grant','',1000,0,?)", id.alum, college).lastInsertRowid);
  const application = Number(run("INSERT INTO applications (call_id, project_id) VALUES (?,?)", call, pid).lastInsertRowid);
  await act("alum", A.answerApplication, { application, answer: "accept", parts: "500 | Prototype" });
  await act("alum", A.markPaid, { part: get("SELECT id FROM grant_parts").id });
  await act("removed", A.postComment, { id: pid, text: "Does it fly in rain?" });

  const commission = (title: string, client: Who, status: string, doer: Who | null, money: number) => Number(run(
    "INSERT INTO commissions (college_id, client_id, title, brief, reward, status, doer_id, money, created_at) VALUES (?,?,?,'A brief long enough to pass',5,?,?,?,?)",
    college, id[client], title, status, doer ? id[doer] : null, money, old).lastInsertRowid);
  await act("joiner", A.applyCommission, { id: commission("Draw a map", "watcher", "open", null, 0) });
  await act("alum", A.markCommissionPaid, { id: commission("Fix the rig", "alum", "done", "mate", 300) });
  await act("lead", A.sendGift, { to: id.joiner, amount: 10 });

  as("mate");
  assert.ok("message" in (await Chat.sendMessage(id.watcher, "Hi there")));
  const photo = new FormData();
  photo.set("to", String(id.watcher));
  photo.set("file", new File([PNG], "kite.png", { type: "image/png" }));
  await post("lead", await import("../app/api/messages/attach/route"), photo);

  const calls = await import("../app/api/calls/route");
  const ring = await post("lead", calls, { action: "start", to: id.joiner, device: DEVICE.lead });
  await post("lead", calls, { action: "end", id: ring.id, device: DEVICE.lead });
  const teamCall = await import("../app/api/team-call/route");
  await post("lead", teamCall, { action: "join", project: pid, device: DEVICE.lead, video: true });
  await post("mate", teamCall, { action: "join", project: pid, device: DEVICE.mate, video: true });

  as("mate");
  const sent = await Team.sendTeamMessage(pid, "Demo is Friday");
  assert.ok("message" in sent);
  assert.ok("pins" in (await Team.pinTeamMessage(pid, sent.message.id, true)));

  await act("lead", A.requestClub, { name: "Kite Club", about: "Kites" });
  const club = get("SELECT id FROM clubs WHERE name='Kite Club'").id as number;
  await act("admin", A.decideClub, { club, do: "approve" });
  await act("removed", A.joinClub, { club });
  await act("lead", A.inviteToClub, { club, user: id.joiner });
  await act("joiner", A.answerClubInvite, { club, do: "accept" });
  await act("lead", A.deleteClub, { club, confirm: "Kite Club" });
  await act("joiner", A.leaveProject, { id: pid });

  const u = (who: Who) => get("SELECT * FROM users WHERE id=?", id[who]);
  const alive = () => (Object.keys(CAST) as Who[]).filter((w) => !u(w).deleted);

  /* Everything anyone is shown of those lines, as plain text. */
  async function seen() {
    const { inbox } = await import("../lib/account");
    const { teamMessages } = await import("../lib/teamchat");
    const { GET } = await import("../app/api/me/export/route");
    const inboxes = {} as Record<Who, string[]>, exported = {} as Record<Who, string[]>, pages: string[] = [];
    const Inbox = await page("inbox/page.tsx"), Project = await page("projects/[id]/page.tsx"), Board = await page("page.tsx");
    for (const who of alive()) {
      as(who);
      inboxes[who] = inbox(u(who)).items.map((i) => i.text);
      exported[who] = (await (await GET()).json()).notifications.map((n: { text: string }) => n.text);
      pages.push(await html(await Inbox()));
    }
    const viewer = alive().includes("watcher") ? "watcher" : "admin";
    as(viewer);
    const project = await html(await Project({ params: Promise.resolve({ id: String(pid) }) }));
    const board = await html(await Board({ searchParams: Promise.resolve({}) }));
    let card = "";
    if (!u("mate").deleted) {
      as("mate"); // only the team sees the last line of its chat on the project page
      card = await html(await Project({ params: Promise.resolve({ id: String(pid) }) }));
    }
    pages.push(project, board, card);
    return {
      inboxes, exported, project: textIn(project), board: textIn(board), card: textIn(card), pages,
      team: teamMessages(pid, id.mate).filter((m) => m.kind === "system").map((m) => m.text),
    };
  }

  /* Every stored cell, except the two places a real name is meant to be kept: users.name and users.real_name. */
  function cells(): { at: string; value: string }[] {
    const out: { at: string; value: string }[] = [];
    for (const { name: table } of all("SELECT name FROM sqlite_master WHERE type='table'"))
      for (const r of all(`SELECT rowid AS _row, * FROM ${table}`))
        for (const [col, v] of Object.entries(r))
          if (typeof v === "string" && !(table === "users" && (col === "name" || col === "real_name"))) out.push({ at: `${table}.${col}#${r._row}`, value: v });
    return out;
  }

  return {
    id, pid, college, all, get, run, now, as, act, u, seen, cells,
    anonymous: (who: Who, on = true, fresh = false) => act(who, setAnonymousMode, { on: on ? 1 : 0, fresh: fresh ? 1 : 0, back: "/settings" }),
    remove: (who: Who) => act(who, A.deleteAccount, { confirm: "delete", back: "/settings" }),
  };
}
export type World = Awaited<ReturnType<typeof world>>;

/* Every line whose readers still exist reads with the name that person goes by now, or with what `expected` says. */
export async function assertNamedNow(w: World, label: string, expected?: (by: Who, line: string) => string | string[]) {
  const s = await w.seen();
  const raw = [...s.pages, ...s.team, ...Object.values(s.inboxes).flat(), ...Object.values(s.exported).flat()].filter((t) => t.includes("{name}"));
  assert.deepEqual(raw, [], `${label}: a name slot reached a reader unfilled`);
  for (const [by, where, text] of LINES) {
    if (where !== "updates" && where !== "team" && !s.inboxes[where]) continue; // that inbox went with its account
    const allowed = [expected ? expected(by, text("…")) : (w.u(by).name as string)].flat().map(text), want = allowed.join("” or “");
    const shows = (shown: string | string[]) => allowed.some((line) => shown.includes(line));
    if (where === "updates") assert.ok(shows(s.project), `${label}: project page should show “${want}”`);
    else if (where === "team") assert.ok(shows(s.team), `${label}: team chat should show “${want}”, shows ${JSON.stringify(s.team)}`);
    else {
      assert.ok(shows(s.inboxes[where]), `${label}: ${where}'s inbox should show “${want}”, shows ${JSON.stringify(s.inboxes[where])}`);
      assert.ok(shows(s.exported[where]), `${label}: ${where}'s data download should show “${want}”`);
    }
  }
  return s;
}

/* No trace of `name` in what is stored or in what is shown. */
export async function assertGone(w: World, name: string, label: string) {
  // The surname alone counts too; an alias ("Anon 48213097") is only itself.
  const needles = /^Anon \d+$/.test(name) ? [name, encodeURIComponent(name)] : [name, name.split(" ").pop()!];
  const has = (t: string) => needles.some((n) => t.includes(n));
  const stored = w.cells().filter((c) => has(c.value)).map((c) => c.at);
  const s = await w.seen();
  const shown = [
    ...Object.entries(s.inboxes).flatMap(([who, ls]) => ls.filter(has).map((t) => `${who} inbox: ${t}`)),
    ...Object.entries(s.exported).flatMap(([who, ls]) => ls.filter(has).map((t) => `${who} download: ${t}`)),
    ...s.team.filter(has).map((t) => `team chat: ${t}`),
    ...s.pages.flatMap((p, i) => (has(p) ? [`page ${i}`] : [])),
  ];
  assert.deepEqual({ stored, shown }, { stored: [], shown: [] }, `${label}: a name that should be gone`);
}
