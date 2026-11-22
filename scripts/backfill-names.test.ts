/* The one-time fix for lines stored with names in them (scripts/backfill-names.js), run as it would be on the server,
   against invented data. Run with: npm test. Throwaway database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ACTORS, CAST, assertGone, assertNamedNow, world, type World } from "./names-world";

const file = () => process.env.DATABASE_PATH!;
let copies = 0;
function backfill(...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "backfill-names.js"), file(), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
function apply() {
  const backup = `${file()}.backup-${++copies}`;
  const r = backfill("--apply", "--backup", backup);
  assert.equal(r.code, 0, r.out);
  return { ...r, backup };
}
const changed = (out: string) => Number(out.match(/(\d+) lines (no longer|would no longer) hold/)?.[1]);

/* Rewinds the three tables to what the code before this fix stored: the name as it was then, and no actor. */
async function asOldCodeWroteIt(w: World) {
  const { lineText } = await import("../lib/identity");
  for (const table of ["updates", "notifications", "team_messages"])
    for (const r of w.all(`SELECT * FROM ${table}`)) w.run(`UPDATE ${table} SET text=?, actor_id=NULL WHERE id=?`, lineText(r), r.id);
}
const dump = (w: World) => JSON.stringify(["updates", "notifications", "team_messages", "call_signals", "team_signals", "users"].map((t) => w.all(`SELECT * FROM ${t} ORDER BY id`)));

/* Wordings with no record of who it was, or whose record went with the deleted club: placed only by a name that is on
   show right now. */
const GUESSED = /asked to be verified|asked to join|asked to start a club|invited you to join|joined Kite Club|was deleted by/;

test("old lines: for people showing their name nothing reads differently, and from then on the lines follow them", async () => {
  const w = await world();
  await asOldCodeWroteIt(w);
  const r = apply();
  assert.match(r.out, /\b0 of them read differently straight away/);
  assert.match(r.out, /\b0 could not be placed safely/);
  await assertNamedNow(w, "backfilled", (by) => CAST[by]);

  for (const who of ACTORS) await w.anonymous(who);
  await assertNamedNow(w, "backfilled, then anonymous");
  for (const who of ACTORS) await assertGone(w, CAST[who], `${who}, anonymous after the backfill`);

  const first = new Map(ACTORS.map((who) => [who, w.u(who).name as string]));
  for (const who of ACTORS) await w.anonymous(who, true, true);
  await assertNamedNow(w, "backfilled, then a new alias");
  for (const who of ACTORS) await assertGone(w, first.get(who)!, `${who}'s first alias`);

  for (const who of ["joiner", "removed"] as const) {
    await w.remove(who);
    await assertGone(w, CAST[who], `${who}, deleted after the backfill`);
  }
  await assertNamedNow(w, "backfilled, then deleted");
});

test("old lines of people anonymous now: the real name goes, and is never guessed from", async () => {
  const w = await world();
  await asOldCodeWroteIt(w);
  for (const who of ACTORS) await w.anonymous(who);
  apply();
  for (const who of ACTORS) await assertGone(w, CAST[who], `${who}, anonymous before the backfill`);
  await assertNamedNow(w, "anonymous before the backfill", (by, line) => (GUESSED.test(line) ? "Someone" : w.u(by).name));
});

test("old lines written under an alias that was switched since: the old alias goes", async () => {
  const w = await world({ anonymous: ACTORS });
  const first = new Map(ACTORS.map((who) => [who, w.u(who).name as string]));
  await asOldCodeWroteIt(w);
  for (const who of ACTORS) await w.anonymous(who, true, true);
  apply();
  for (const who of ACTORS) await assertGone(w, first.get(who)!, `${who}'s old alias`);
  await assertNamedNow(w, "switched before the backfill", (by, line) => (GUESSED.test(line) ? "Someone" : w.u(by).name));
});

test("old lines written under an alias by someone named again: the backfill does not tie the alias to the name", async () => {
  const w = await world({ anonymous: ACTORS });
  const alias = new Map(ACTORS.map((who) => [who, w.u(who).name as string]));
  await asOldCodeWroteIt(w);
  for (const who of ACTORS) await w.anonymous(who, false);
  apply();
  await assertNamedNow(w, "named again before the backfill", () => "Someone");
  const stored = w.cells().filter((c) => /^(updates|notifications|team_messages)\.text#/.test(c.at));
  for (const who of ACTORS) assert.deepEqual(stored.filter((c) => c.value.includes(alias.get(who)!)), [], who);
});

test("old lines of deleted accounts: no name is left, and nobody else is given their lines", async () => {
  for (const anonymous of [false, true])
    for (const who of ACTORS) {
      const w = await world({ anonymous: anonymous ? [who] : [] });
      const shownAs = w.u(who).name as string;
      await asOldCodeWroteIt(w);
      await w.remove(who);
      apply();
      await assertGone(w, CAST[who], `${who}, deleted before the backfill`);
      await assertGone(w, shownAs, `${who}, name on deletion`);
      const s = await w.seen();
      // Placed by the row itself, whatever else the account took with it.
      if (who === "lead") assert.ok(s.project.includes("Deleted user posted the project"));
      if (who === "joiner") assert.ok(s.project.includes("Deleted user joined as Builder"));
      if (who === "alum") assert.ok(s.project.includes("Funded by Deleted user"));
      if (who === "mate") assert.ok(s.inboxes.watcher.includes("Deleted user sent you a message"));
      // Everyone else keeps every line a record places. A deleted account could have had any name, so the few lines only
      // a name could place read "Someone" instead.
      await assertNamedNow(w, `${who} deleted before the backfill`, (by, line) =>
        by === who ? ["Deleted user", "Someone"] : GUESSED.test(line) ? "Someone" : CAST[by]);
    }
});

test("it changes nothing the second time, and nothing the fixed code wrote", async () => {
  const w = await world();
  let before = dump(w);
  assert.equal(changed(backfill().out), 0, "new lines need no fixing");
  apply();
  assert.equal(dump(w), before, "new lines are left exactly as they are");

  await asOldCodeWroteIt(w);
  const first = apply();
  assert.equal(changed(first.out) > 0, true);
  before = dump(w);
  assert.equal(changed(apply().out), 0);
  assert.equal(dump(w), before, "the second run changes nothing");

  // After a rollback the old code writes names again; only those lines change on the next run.
  w.run("INSERT INTO updates (project_id, user_id, kind, text, created_at) VALUES (?,?,'event',?,?)", w.pid, w.id.lead, `${CAST.lead} made the project public`, w.now());
  assert.equal(changed(apply().out), 1);
});

test("a dry run changes nothing and prints nobody's name", async () => {
  const w = await world();
  await asOldCodeWroteIt(w);
  await w.anonymous("lead");
  const before = dump(w);
  const dry = backfill();
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /^Dry run: nothing was changed\./);
  assert.equal(dump(w), before);
  const done = apply();
  for (const name of [...Object.values(CAST), w.u("lead").name as string]) for (const out of [dry.out, done.out]) {
    assert.ok(!out.includes(name), `the report printed ${name}`);
    assert.ok(!out.includes(name.split(" ").pop()!), `the report printed part of ${name}`);
  }
  assert.equal(changed(done.out), changed(dry.out), "the dry run says exactly what applying does");
});

test("applying needs a new backup file, which is checked and keeps what was there", async () => {
  const w = await world();
  await asOldCodeWroteIt(w);
  const before = dump(w);
  const taken = `${file()}.taken`;
  fs.writeFileSync(taken, "someone's earlier backup");
  for (const args of [["--apply"], ["--apply", "--backup"], ["--apply", "--backup", taken], ["--aply"]]) {
    const r = backfill(...args);
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(dump(w), before, args.join(" "));
  }
  assert.equal(fs.readFileSync(taken, "utf8"), "someone's earlier backup");

  const { backup } = apply();
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  const Database = (await import("better-sqlite3")).default;
  const copy = new Database(backup, { readonly: true });
  try {
    assert.ok(copy.prepare("SELECT 1 FROM updates WHERE text=?").get(`${CAST.lead} posted the project`), "the backup holds the lines as they were");
  } finally { copy.close(); }
  for (const beside of ["-wal", "-shm"]) assert.ok(!fs.existsSync(backup + beside), "the backup is one file, even after it has been read");
});

test("a database the fixed app has not opened: the dry run works, applying refuses", async () => {
  const w = await world();
  await asOldCodeWroteIt(w);
  const Database = (await import("better-sqlite3")).default;
  const old = `${file()}.before-deploy`;
  fs.rmSync(old, { force: true });
  const source = new Database(file(), { readonly: true });
  await source.backup(old);
  source.close();
  const d = new Database(old);
  for (const t of ["updates", "notifications", "team_messages"]) d.exec(`ALTER TABLE ${t} DROP COLUMN actor_id`);
  d.close();
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "backfill-names.js"), old, ...args], { encoding: "utf8" });
  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(changed(dry.stdout), changed(backfill().out));
  const refused = run("--apply", "--backup", `${old}.backup`);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Deploy it first/);
});

/* A bare community for hand-written rows. */
async function blank() {
  const { run, get, all, now, TABLES } = await import("../lib/db");
  const { lineText } = await import("../lib/identity");
  for (const t of TABLES) run(`DELETE FROM ${t}`);
  const at = now() - 3600;
  const college = Number(run("INSERT INTO colleges (slug, name, domains, created_at) VALUES ('look','Look','look.example',?)", at).lastInsertRowid);
  let n = 0;
  const person = (name: string, joined = at - 86400) =>
    Number(run("INSERT INTO users (sub, name, verified, onboarded, college_id, created_at) VALUES (?,?,1,1,?,?)", `t:look${++n}`, name, college, joined).lastInsertRowid);
  const reader = person("Reader Plainfield");
  const project = (name: string, lead: number) => Number(run("INSERT INTO projects (name, pitch, lead_id, college_id, created_at) VALUES (?,'p',?,?,?)", name, lead, college, at).lastInsertRowid);
  const update = (pid: number, by: number | null, text: string, kind = "event") =>
    ({ table: "updates", id: Number(run("INSERT INTO updates (project_id, user_id, kind, text, created_at) VALUES (?,?,?,?,?)", pid, by, kind, text, at).lastInsertRowid) });
  const note = (text: string, href: string, to = reader, when = at) =>
    ({ table: "notifications", id: Number(run("INSERT INTO notifications (user_id, text, href, created_at) VALUES (?,?,?,?)", to, text, href, when).lastInsertRowid) });
  const team = (pid: number, text: string, by: number | null = null) =>
    ({ table: "team_messages", id: Number(run("INSERT INTO team_messages (project_id, user_id, text, kind, created_at) VALUES (?,?,?,?,?)", pid, by, text, by ? "text" : "system", at).lastInsertRowid) });
  const row = (r: { table: string; id: number }) => get(`SELECT * FROM ${r.table} WHERE id=?`, r.id);
  const hide = async (id: number) => (await import("../lib/identity")).setAnonymous(get("SELECT * FROM users WHERE id=?", id), true)!;
  return { run, get, all, at, college, reader, person, project, update, note, team, row, hide, read: (r: { table: string; id: number }) => lineText(row(r)) };
}

test("words that merely contain a name are never touched", async () => {
  const b = await blank();
  const dev = b.person("Dev"), mark = b.person("Mark"), an = b.person("An"), will = b.person("Will");
  const p = b.project("DevTools for Developers", dev);
  b.run("INSERT INTO grants (project_id, alum_id, amount) VALUES (?,?,1)", p, mark);
  b.run("INSERT INTO grant_parts (grant_id, title, amount) VALUES ((SELECT MAX(id) FROM grants),'Market research on Markdown, Mark II',1)");
  const lines = [
    [b.update(p, dev, "Dev posted the project"), "{name} posted the project", dev],
    [b.update(p, dev, "Dev joined as DevOps lead for Devanagari docs (Dev)"), "{name} joined as DevOps lead for Devanagari docs (Dev)", dev],
    [b.update(p, will, "Will joined as Willow keeper, Will it work?"), "{name} joined as Willow keeper, Will it work?", will],
    [b.update(p, an, "Funded by An"), "Funded by {name}", an],
    [b.note("Mark marked a payment as sent: Market research on Markdown, Mark II", `/projects/${p}`), "{name} marked a payment as sent: Market research on Markdown, Mark II", mark],
    [b.note("Dev invited you to apply for Developer on DevTools for Developers", `/projects/${p}`), "{name} invited you to apply for Developer on DevTools for Developers", dev],
    [b.note("Will sent you a message", `/messages/${will}`), "{name} sent you a message", will],
  ] as const;
  apply();
  for (const [line, text, actor] of lines) {
    assert.equal(b.row(line).text, text);
    assert.equal(b.row(line).actor_id, actor, text);
  }
  await b.hide(dev);
  const alias = b.get("SELECT name FROM users WHERE id=?", dev).name;
  assert.equal(b.read(lines[1][0]), `${alias} joined as DevOps lead for Devanagari docs (Dev)`, "only the name's own place changes");
});

test("what people typed, and lines about nobody, stay exactly as they are", async () => {
  const b = await blank();
  const dev = b.person("Dev"), p = b.project("Who is funding us", dev);
  const other = b.project("Kite", dev), curious = b.project("Why I asked about rivers", dev);
  b.update(other, dev, "Mira is funding us now", "post");
  const keep = [
    b.update(p, dev, "Dev posted the project", "post"),
    b.update(p, dev, "Funded by Dev, honestly", "post"),
    b.update(p, dev, "Milestone done: Dev joined as tester"),
    b.update(p, dev, "Renamed from Everyone joined as one"),
    b.update(p, null, "Reviewer note (live): Dev joined as promised"),
    b.update(p, dev, "Posted the project"),
    b.update(p, dev, "Project posted"),
    b.update(p, dev, "Sent for review"),
    b.team(p, "Dev left the team", dev),
    b.team(p, "Team video call ended · 3:12"),
    b.note("Who is funding us is in review", `/projects/${p}`),
    b.note("Who is funding us was dropped by its lead. Your stake is back.", `/projects/${p}`),
    b.note("Who is funding us shipped with a pot of 100. Split the credit between your teammates.", `/projects/${p}`),
    b.note("You are on the Ask to join team as Host", `/projects/${p}`),
    b.note("Kite: Mira is funding us now", `/projects/${other}`),
    b.note("Kite replied: Dev asked about Kite: is it open?", `/projects/${other}#questions`),
    b.note("Why I asked about rivers replied: see the map: page 2", `/projects/${curious}#questions`),
    b.note("Chess was not approved: you joined twice", "/clubs/4"),
    b.note("You are now a member of We joined Hands", "/clubs/4"),
    b.note("We joined Hands is approved. It is now on the Clubs page for everyone in your community.", "/clubs/4"),
    b.note("Chess planned: Dev joined the open night", "/clubs/4#plans"),
    b.note("“Who applied to do “X”” was delivered. Check it and sign off.", "/commissions/3"),
    b.note("You were picked to do “Find who applied to do “X””", "/commissions/3"),
    b.note(`Your evidence was verified: Dev says you were on their team at X. Confirm it if that is true.`, `/u/${b.reader}?tab=work#evidence`),
    b.note("Your evidence was verified: Hack", `/u/${b.reader}?tab=work#evidence`),
    b.note("New feedback (bug): Dev sent you a message", "/admin/feedback"),
    b.note("Dev's app applied to Parts grant", "/funding"),
    b.note("New report on a person", "/admin"),
    b.note("New sign-in to your account from Chrome on Mac. Not you? Sign out of all other devices in Settings.", "/settings#devices"),
  ];
  const before = keep.map((r) => b.row(r));
  const { out } = apply();
  assert.equal(changed(out), 0, out);
  assert.deepEqual(keep.map((r) => b.row(r)), before);
});

test("odd names: regex signs, line breaks, other scripts, names inside names", async () => {
  const b = await blank();
  for (const name of ["A.J. (Ace) O'Neil+$& [2]", "Line\nBreak", "निरवा कल्पित", "$1 {name}", "Ann", "Ann Marie"]) {
    const id = b.person(name), p = b.project("Odd", id);
    const posted = b.update(p, id, `${name} posted the project`), missed = b.note(`Missed video call from ${name}`, `/messages/${id}`);
    apply();
    assert.equal(b.row(posted).text, "{name} posted the project", name);
    assert.equal(b.read(posted), `${name} posted the project`, name);
    assert.equal(b.read(missed), `Missed video call from ${name}`, name);
    const alias = await b.hide(id);
    assert.equal(b.read(posted), `${alias} posted the project`, name);
    assert.equal(b.read(missed), `Missed video call from ${alias}`, name);
  }
});

test("a record that does not fit the name, or a guess with two answers, becomes Someone and never another person", async () => {
  const b = await blank();
  const p = b.project("Kite", b.reader), askers = (...who: number[]) => who.forEach((u) => b.run("INSERT INTO requests (project_id, user_id) VALUES (?,?)", p, u));
  const same = [b.person("Tavi Orrel"), b.person("Tavi Orrel")];
  const named = b.person("Ness Calloway"), hidden = b.person("Ness Calloway"), alone = b.person("Lumo Quenby"), later = b.person("Pell Harnwick", b.at + 60);
  askers(...same, named, hidden, alone, later);
  await b.hide(hidden);
  await b.hide(alone);
  const wrong = b.person("Wren Oakhollow");
  b.run("INSERT INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", wrong, b.reader, b.at);
  const lines = {
    "two people with that name": b.note("Tavi Orrel asked to join Kite as Host", `/projects/${p}#requests`),
    "an anonymous namesake": b.note("Ness Calloway asked to join Kite as Host", `/projects/${p}#requests`),
    "only a hidden real name": b.note("Lumo Quenby asked to join Kite as Host", `/projects/${p}#requests`),
    "an account newer than the line": b.note("Pell Harnwick asked to join Kite as Host", `/projects/${p}#requests`),
    "someone else's record in that second": b.note("Gone Person vouched for you", `/u/${b.reader}`),
    "nobody known": b.note("Gone Person asked to join Kite as Host", `/projects/${p}#requests`),
  };
  apply();
  for (const [why, line] of Object.entries(lines)) {
    assert.equal(b.row(line).actor_id, 0, why);
    assert.match(b.read(line), /^Someone (asked to join Kite as Host|vouched for you)$/, why);
  }
});

test("without a record, a name places a line only when no deleted account could have had it", async () => {
  const b = await blank();
  const left = b.person("Juno Ashgrove"), p = b.project("Kite", b.reader);
  // Juno withdrew, so no request says who asked.
  const certain = b.note("Juno Ashgrove asked to join Kite as Host", `/projects/${p}#requests`);
  apply();
  assert.equal(b.row(certain).actor_id, left);

  const doubtful = b.note("Juno Ashgrove asked to join Kite as Scout", `/projects/${p}#requests`);
  const gone = b.person("Another Name");
  b.run("UPDATE users SET name='Deleted user', deleted=1 WHERE id=?", gone);
  apply();
  assert.equal(b.read(doubtful), "Someone asked to join Kite as Scout", "the deleted account may have been a Juno Ashgrove too");
});

test("someone who asked to be verified and then moved is not mistaken for a namesake left behind", async () => {
  const b = await blank();
  const moved = b.person("Iva Larkfield");
  b.person("Iva Larkfield");
  b.run("UPDATE users SET college_id=? WHERE id=?", b.college + 1, moved);
  const ask = b.note("Iva Larkfield asked to be verified as a member of Look", "/admin");
  apply();
  assert.equal(b.read(ask), "Someone asked to be verified as a member of Look");
});

test("a made-up person and a real one who share a name are not mixed up", async () => {
  const b = await blank();
  const p = b.project("Kite", b.reader);
  const fake = Number(b.run("INSERT INTO users (sub, name, college_id, created_at) VALUES ('demo:look:1','Orla Finchley',?,?)", b.college, b.at - 86400).lastInsertRowid);
  b.run("INSERT INTO requests (project_id, user_id) VALUES (?,?)", p, fake);
  const real = b.note("Orla Finchley asked to join Kite as Host", `/projects/${p}#requests`);
  // A line from before the "(fake)" mark, placed by its own row.
  const posted = b.update(p, fake, "Orla Finchley posted the project");
  apply();
  assert.equal(b.row(real).actor_id, 0);
  assert.equal(b.read(posted), "Orla Finchley (fake) posted the project");
});

test("every older wording found in git history is covered", async () => {
  const b = await blank();
  const a = b.person("Mira Velloway"), p = b.project("Kite", a);
  b.run("INSERT INTO requests (project_id, user_id) VALUES (?,?)", p, a);
  b.run("INSERT INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", a, b.reader, b.at);
  const old: [string, string][] = [
    ["asked to be verified as a student of Look", "/admin"],
    ["asked to join Kite as Host", `/projects/${p}`],
    ["sent you a file", `/messages/${a}`],
    ["sent you a photo", `/messages/${a}`],
    ["is waiting for alumni approval", "/admin"],
    ["vouched for your verified credit", `/u/${b.reader}`],
    ['posted an open role on Kite: "Host"', `/projects/${p}`],
    ["opened a new ₹40,000 Hardware Grant for Look teams", "/funding"],
  ];
  const rows = old.map(([rest, href]) => b.note(`Mira Velloway ${rest}`, href));
  apply();
  rows.forEach((r, i) => assert.equal(b.row(r).text, `{name} ${old[i][0]}`, old[i][0]));
});

test("expired call signals with a name in them go; a call ringing now is left alone", async () => {
  const b = await blank();
  // The script's own clock: the test community runs ahead of it.
  const real = Math.floor((performance.timeOrigin + performance.now()) / 1000);
  const signal = (at: number) => Number(b.run("INSERT INTO call_signals (call_id, to_id, type, payload, created_at) VALUES (1,?,'ring',?,?)",
    b.reader, JSON.stringify({ from: { name: "Mira Velloway" } }), at).lastInsertRowid);
  const gone = signal(real - 3600), ringing = signal(real);
  apply();
  assert.equal(b.get("SELECT 1 FROM call_signals WHERE id=?", gone), undefined);
  assert.ok(b.get("SELECT 1 FROM call_signals WHERE id=?", ringing));
});

test("what it leaves for a person to check is listed by row, not by name", async () => {
  const b = await blank();
  const a = b.person("Mira Velloway"), p = b.project("Kite", a);
  b.person("Soren Pikewell");
  const typed = b.update(p, a, "Thanks to mira velloway for the rig", "post");
  const unknown = b.note("Soren Pikewell did something this script has never seen", "/somewhere");
  await b.hide(a);
  const { out } = backfill();
  assert.ok(out.includes(`updates#${typed.id}`), out);
  assert.ok(out.includes(`notifications#${unknown.id}`), out);
  assert.ok(!/velloway|pikewell/i.test(out));
});
