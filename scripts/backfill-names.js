/* Takes names out of lines stored before lib/identity.ts had NAME: activity, inbox notices and team chat lines that
   hold whatever someone was called when they were written. Afterwards those follow anonymous mode, a new alias and
   account deletion like every newer line.

     node scripts/backfill-names.js [database file]                        dry run: says what would change, changes nothing
     node scripts/backfill-names.js [database file] --apply --backup FILE  copies the database to FILE, then changes it

   On the server it is next to server.js, and DATABASE_PATH names the file. Deploy first, so the app can read the new
   lines, then run it, keeping the backup on the volume (anything outside /data is lost at the next deploy):

     node backfill-names.js
     node backfill-names.js --apply --backup /data/connect-before-names.db

   Running it again changes nothing. After a rollback, run it again once this version is back, for the lines the older
   code wrote meanwhile (the older code would show "{name}" as it stands, so never run it while that is serving).
   It prints counts and row numbers, never anyone's name or words.

   It never searches text for names. It knows every wording the app has written (git history holds them all), and
   replaces only the part of that wording where the name stands, so a word, project or note that contains a name stays
   as it is. What people typed (posts, chat, the rest of a line) is never touched.

   Who a line names comes from the records written with it (an id in the row or link, or a row from the same second),
   and only if the name in the line is one that person could have had then. Where no record says, it is someone only
   if nobody else in that community could have been called that then: one person shows that very name, no namesake is
   hidden behind an alias, and no account deleted since could have had it (which is any deleted account). Someone not
   yet verified can move community, so for those asks the whole site counts. A hidden real name never makes a match, or
   the script would tie an alias to a name. Anyone it cannot place becomes "Someone", so the name goes either way. */
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const NAME = "{name}", FAKE = " (fake)"; // lib/identity.ts, lib/sample.ts
const TABLES = ["updates", "team_messages", "notifications"];
const SIGNAL_SECONDS = 120; // how long the app itself keeps call signals
const bare = (name) => (name.endsWith(FAKE) ? name.slice(0, -FAKE.length) : name);
// The two kinds of alias there have been.
const aliasLike = (name) => /^Anon [1-9]\d{7,8}$|^[a-z]+-[a-z]+\d{3}$/.test(bare(name));
const cut = (text, max) => (text.length > max ? text.slice(0, max - 3) + "..." : text); // as lib/notify.ts shortens
const idIn = (href) => Number(href.match(/\d+/)?.[0] ?? 0);

/* Works out every change without making any. */
function plan(db) {
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const ids = (sql, ...a) => all(sql, ...a).map((r) => Object.values(r)[0]);

  const users = new Map(all("SELECT id, name, real_name, anon, deleted, college_id, created_at FROM users").map((u) => [u.id, u]));
  const everyName = new Set([...users.values()].filter((u) => !u.deleted).flatMap((u) => [u.name, u.real_name].filter(Boolean).map(bare)));
  /* A record's own row is written in the same second as its line or the one before. */
  const then = (r, seconds = 1) => [(r.created_at ?? -1e12) - seconds, r.created_at ?? -1e12];
  const collegeOf = (r) => users.get(r.user_id)?.college_id;
  const communityOf = (r) => (r.project_id ? ids("SELECT college_id FROM projects WHERE id=?", r.project_id)[0] : collegeOf(r));
  const leadOf = (r) => ids("SELECT lead_id FROM projects WHERE id=?", idIn(r.href));
  const leftThen = (r) => ids("SELECT user_id FROM members WHERE project_id=? AND status='left' AND left_at BETWEEN ? AND ?", r.project_id, ...then(r));
  function joinedThen(r, m) {
    return all("SELECT user_id, text FROM updates WHERE project_id=? AND kind='event' AND user_id IS NOT NULL AND created_at BETWEEN ? AND ?", r.project_id, ...then(r))
      .filter((u) => { const t = String(u.text ?? ""), at = t.indexOf(" joined as "); return at >= 0 && t.slice(at + 11).startsWith(m.groups.title); })
      .map((u) => u.user_id);
  }
  /* A follower's copy of an update, "Project: what was posted", can say anything at all. */
  function followerCopy(r) {
    return all("SELECT text FROM updates WHERE project_id=? AND created_at BETWEEN ? AND ?", idIn(r.href), ...then(r))
      .some((u) => r.text.endsWith(`: ${cut(String(u.text ?? ""), 90)}`));
  }

  /* Each wording: where it is, the sentence with the name as `who`, who the records say did it (`did`), and whether
     the name may place it when no record does (`guess`). */
  const PROJECT = /^\/projects\/\d+$/, CLUB = /^\/clubs\/\d+$/, COMMISSION = /^\/commissions\/\d+$/, CHAT = /^\/messages\/\d+$/;
  const RULES = {
    updates: [
      { label: "posted the project", line: /^(?<who>.+) posted the project$/ds, did: (r) => [r.user_id] },
      { label: "made the project public", line: /^(?<who>.+) made the project public$/ds, did: (r) => [r.user_id] },
      { label: "joined as", line: /^(?<who>.+?) joined as .*$/ds, did: (r) => [r.user_id] },
      { label: "Funded by", line: /^Funded by (?<who>.+)$/ds, did: (r) => [r.user_id] },
    ],
    team_messages: [
      { label: "joined the team as", line: /^(?<who>.+?) joined the team as (?<title>.*)$/ds, did: joinedThen, guess: true },
      { label: "was removed by the team", line: /^(?<who>.+) was removed by the team$/ds, did: leftThen, guess: true },
      { label: "left the team", line: /^(?<who>.+) left the team$/ds, did: leftThen, guess: true },
      { label: "pinned a message", line: /^(?<who>.+) pinned a message$/ds, guess: true,
        did: (r) => ids("SELECT by_id FROM team_pins WHERE project_id=? AND created_at BETWEEN ? AND ?", r.project_id, ...then(r)) },
      { label: "started a team call", line: /^(?<who>.+) started a team (video|voice) call$/ds, guess: true,
        did: (r) => ids("SELECT started_by FROM team_calls WHERE project_id=? AND created_at BETWEEN ? AND ?", r.project_id, ...then(r)) },
    ],
    notifications: [
      { label: "says they are an alum", href: /^\/admin$/, line: /^(?<who>.+?) says they are an alum of .+\. Approve them if that is true\.$/ds,
        did: (r) => ids("SELECT id FROM users WHERE college_id=? AND role='alum' AND terms_at BETWEEN ? AND ?", collegeOf(r), ...then(r)), guess: true },
      { label: "asked to be verified", href: /^\/admin$/, line: /^(?<who>.+?) asked to be verified as a (member|student) of .+$/ds, guess: "anywhere" },
      { label: "waiting for alumni approval", href: /^\/admin$/, line: /^(?<who>.+) is waiting for alumni approval$/ds, guess: true },
      { label: "added evidence to check", href: /^\/admin#evidence$/, line: /^(?<who>.+?) added evidence to check: (?<title>.*)$/ds, guess: true,
        // A code may have been emailed in between, so the record can be some seconds older.
        did: (r, m) => ids("SELECT user_id FROM evidence WHERE college_id=? AND title=? AND created_at BETWEEN ? AND ?", collegeOf(r), m.groups.title, ...then(r, 30)) },
      { label: "asked to start a club", href: /^\/admin#clubs$/, line: /^(?<who>.+?) asked to start a club: .*$/ds, guess: true,
        did: (r) => ids("SELECT created_by FROM clubs WHERE college_id=? AND created_at BETWEEN ? AND ?", collegeOf(r), ...then(r)) },
      { label: "invited you to apply", href: PROJECT, line: /^(?<who>.+?) invited you to apply for .+ on .+$/ds, did: leadOf },
      { label: "asked to join a project", href: /^\/projects\/\d+(#requests)?$/, line: /^(?<who>.+?) asked to join .+ as .+$/ds, guess: true },
      { label: "is funding", href: PROJECT, line: /^(?<who>.+?) is funding .+$/ds,
        did: (r) => ids("SELECT user_id FROM updates WHERE project_id=? AND kind='event' AND text LIKE 'Funded by %' AND created_at BETWEEN ? AND ?", idIn(r.href), ...then(r)),
        guess: true },
      { label: "marked a payment as sent", href: PROJECT, line: /^(?<who>.+?) marked a payment as sent: (?<title>.*)$/ds,
        did: (r, m) => ids("SELECT g.alum_id FROM grants g JOIN grant_parts p ON p.grant_id=g.id WHERE g.project_id=? AND p.title=?", idIn(r.href), m.groups.title) },
      { label: "posted an open role", href: PROJECT, line: /^(?<who>.+?) posted an open role on .+$/ds, did: leadOf },
      { label: "asked about", href: /^\/projects\/\d+#questions$/, line: /^(?<who>(?:(?! replied: ).)+?) asked about .+: .*$/ds,
        did: (r) => all("SELECT user_id, text FROM comments WHERE project_id=? AND created_at BETWEEN ? AND ?", idIn(r.href), ...then(r))
          .filter((c) => r.text.endsWith(`: ${cut(c.text, 60)}`)).map((c) => c.user_id),
        guess: true },
      { label: "started a team call", href: /^\/projects\/\d+\/chat$/, line: /^(?<who>.+?) started a team (video|voice) call in .+$/ds,
        did: (r) => ids("SELECT started_by FROM team_calls WHERE project_id=? AND created_at BETWEEN ? AND ?", idIn(r.href), ...then(r)),
        guess: true },
      { label: "vouched for you", href: /^\/u\/\d+$/, line: /^(?<who>.+) vouched for (you|your verified credit)$/ds,
        did: (r) => ids("SELECT from_id FROM vouches WHERE to_id=? AND created_at BETWEEN ? AND ?", r.user_id, ...then(r)),
        guess: true },
      // The link to the sender's profile. The same link to your own profile is a verdict on your evidence, about nobody.
      { label: "says you were on their team", href: /^\/u\/\d+\?tab=work#evidence$/, when: (r) => idIn(r.href) !== r.user_id,
        line: /^(?<who>.+?) says you were on their team at .+\. Confirm it if that is true\.$/ds, did: (r) => [idIn(r.href)] },
      { label: "applied to a commission", href: COMMISSION, line: /^(?<who>.+?) applied to do “.*”$/ds,
        did: (r) => ids("SELECT user_id FROM commission_apps WHERE commission_id=? AND created_at BETWEEN ? AND ?", idIn(r.href), ...then(r)),
        guess: true },
      { label: "marked a commission's payment", href: COMMISSION, line: /^(?<who>.+?) marked the payment for “.*” as sent$/ds,
        did: (r) => ids("SELECT client_id FROM commissions WHERE id=?", idIn(r.href)) },
      { label: "sent you credit", href: /^\/credit$/, line: /^(?<who>.+) sent you (?<amount>\d+) credit to use$/ds,
        did: (r, m) => ids("SELECT from_id FROM gifts WHERE to_id=? AND amount=? AND created_at BETWEEN ? AND ?", r.user_id, Number(m.groups.amount), ...then(r)),
        guess: true },
      { label: "sent you a message or file", href: CHAT, line: /^(?<who>.+) sent you a (message|photo|video|voice note|file)$/ds, did: (r) => [idIn(r.href)] },
      { label: "missed call", href: CHAT, line: /^Missed (voice|video) call from (?<who>.+)$/ds, did: (r) => [idIn(r.href)] },
      { label: "asked to join a club", href: CLUB, line: /^(?<who>.+?) asked to join .+$/ds, guess: true },
      { label: "invited you to a club", href: CLUB, line: /^(?<who>.+?) invited you to join .+$/ds, guess: true },
      { label: "joined a club", href: CLUB, line: /^(?<who>.+?) joined .+$/ds, guess: true },
      { label: "deleted a club", href: /^\/clubs$/, line: /^.+ was deleted by (?<who>.+)$/ds, guess: true },
      { label: "opened a grant", href: /^\/funding$/, line: /^(?<who>.+?) opened a new ₹.+$/ds, guess: true },
    ],
  };

  /* Lines about nobody that share a link with ones that name someone. A typed title in one could read like a wording above. */
  function aboutNobody(table, r) {
    if (table === "updates") return /^(Renamed from |Milestone done: )/.test(r.text);
    if (PROJECT.test(r.href)) return /^(You are on the |You were picked to review |Reviewers disagree on |Your team removed you from |An admin spot-checked )/.test(r.text)
      || /( declined your request\. Your stake is back\.| was dropped by its lead\. Your stake is back\.| needs an admin review: too few people outside the team can review it| is in review| is ready for review| was sent back by reviewers as not ready)$/.test(r.text)
      || / shipped with a pot of \d+\. Split the credit between your teammates\.$/.test(r.text);
    if (/^\/projects\/\d+#questions$/.test(r.href)) // the team's answer begins with the project's own name
      return ids("SELECT name FROM projects WHERE id=?", idIn(r.href)).some((name) => r.text.startsWith(`${name} replied: `));
    if (CLUB.test(r.href)) return /^You (are now |can now )|^.+? was not approved: | is approved\. It is now on the Clubs page/s.test(r.text);
    if (COMMISSION.test(r.href)) return /^(“|You were picked |A commission needs |A dispute was opened |An admin decided |An outside reviewer confirmed )/.test(r.text);
    return false;
  }

  /* Could this person have been called that? Names only ever change to an alias, back, or to "Deleted user". */
  const fits = (u, said) => !!u.deleted || (u.anon ? aliasLike(said) || bare(said) === bare(u.real_name ?? "") : bare(said) === bare(u.name));

  function whom(r, rule, m) {
    const said = m.groups.who;
    const recorded = [...new Set(rule.did?.(r, m) ?? [])].map((id) => users.get(id)).filter(Boolean);
    if (recorded.length) {
      const right = recorded.filter((u) => fits(u, said));
      return right.length === 1 ? right[0] : null;
    }
    if (!rule.guess) return null;
    const college = communityOf(r);
    const could = [...users.values()].filter((u) => (rule.guess === "anywhere" || (college && u.college_id === college))
      && !(r.created_at && u.created_at > r.created_at)
      && (u.deleted || bare(u.name) === bare(said) || bare(u.real_name ?? "") === bare(said)));
    // Exactly as written: a real person and a made-up one can share a name, all but the "(fake)".
    return could.length === 1 && could[0].name === said ? could[0] : null;
  }

  const changes = [], after = [];
  for (const table of TABLES)
    for (const row of all(`SELECT * FROM ${table}`)) {
      const r = { ...row, text: String(row.text ?? ""), href: String(row.href ?? "") };
      const appWrote = table === "notifications" || (table === "updates" ? r.kind === "event" : r.kind === "system" && r.user_id == null);
      const end = { table, id: r.id, text: r.text, legacy: appWrote && r.actor_id == null };
      after.push(end);
      if (!end.legacy || (table === "updates" && r.user_id == null)) continue; // newer, typed, or about nobody
      let best = null;
      for (const rule of RULES[table]) {
        if ((rule.href && !rule.href.test(r.href)) || (rule.when && !rule.when(r))) continue;
        const m = rule.line.exec(r.text);
        // Of two wordings that fit, the name is the shorter: the other has swallowed part of the sentence.
        if (m && (!best || m.groups.who.length < best.m.groups.who.length)) best = { rule, m };
      }
      if (!best) continue;
      const { rule, m } = best, said = m.groups.who;
      if (table === "notifications" && PROJECT.test(r.href) && followerCopy(r)) continue;
      if (aboutNobody(table, r) && !everyName.has(bare(said))) continue;

      const person = whom(r, rule, m), [from, to] = m.indices.groups.who;
      const text = r.text.slice(0, from) + (person ? NAME : "Someone") + r.text.slice(to);
      changes.push({
        table, id: r.id, label: rule.label, text, actor: person?.id ?? 0,
        as: !person ? "someone" : person.deleted ? "deleted" : person.anon ? "anonymous" : "named",
        differs: (person ? person.name : "Someone") !== said,
      });
      Object.assign(end, { text, legacy: false });
    }

  const stale = Math.floor(Date.now() / 1000) - SIGNAL_SECONDS;
  const signals = {
    call_signals: ids("SELECT id FROM call_signals WHERE type='ring' AND created_at<?", stale),
    team_signals: ids("SELECT id FROM team_signals WHERE type='joined' AND created_at<?", stale),
  };
  return { changes, signals, after, users, scanned: after.length };
}

/* What is left for a person to look at: row numbers only. */
function leftOver({ after, users }) {
  const word = (name) => ({ name: name.toLowerCase(), re: new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${name.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")}(?![\\p{L}\\p{M}\\p{N}])`, "iu") });
  const live = [...users.values()].filter((u) => !u.deleted);
  const hidden = live.filter((u) => u.anon && u.real_name).map((u) => word(bare(u.real_name)));
  // Two words or more: a first name alone is too often an ordinary word.
  const known = live.flatMap((u) => [u.name, u.real_name]).filter((n) => n && bare(n).includes(" ")).map((n) => word(bare(n)));
  const typed = [], unknown = [];
  for (const r of after) {
    const low = r.text.toLowerCase(), says = (list) => list.some((w) => low.includes(w.name) && w.re.test(r.text));
    if (says(hidden)) typed.push(`${r.table}#${r.id}`);
    else if (r.legacy && says(known)) unknown.push(`${r.table}#${r.id}`);
  }
  return { typed, unknown };
}

function report(p, applied) {
  const n = (f) => p.changes.filter(f).length;
  const out = [
    applied ? "Applied." : "Dry run: nothing was changed.",
    `${p.scanned} rows read in updates, notifications and team_messages.`,
    `${p.changes.length} lines ${applied ? "no longer hold" : "would no longer hold"} a name. Of those:`,
    `  ${n((c) => c.as === "named")} follow a person showing their name`,
    `  ${n((c) => c.as === "anonymous")} follow a person who is anonymous (read as their alias)`,
    `  ${n((c) => c.as === "deleted")} follow a deleted account (read "Deleted user")`,
    `  ${n((c) => c.as === "someone")} could not be placed safely (read "Someone"; only the backup keeps that name)`,
    `${n((c) => c.differs)} of them read differently straight away; the rest read the same until that person's name changes.`,
    `${p.signals.call_signals.length + p.signals.team_signals.length} expired call signals with a name in them ${applied ? "removed" : "would be removed"}.`,
  ];
  if (p.changes.length) {
    const kinds = new Map();
    for (const c of p.changes) {
      const key = `${c.table}: ${c.label}`, k = kinds.get(key) ?? { lines: 0, someone: 0 };
      kinds.set(key, { lines: k.lines + 1, someone: k.someone + (c.as === "someone" ? 1 : 0) });
    }
    out.push("By wording:", ...[...kinds].sort().map(([key, k]) => `  ${String(k.lines).padStart(5)}  ${key}${k.someone ? ` (${k.someone} as "Someone")` : ""}`));
  }
  const left = leftOver(p);
  const list = (rows) => rows.slice(0, 40).join(" ") + (rows.length > 40 ? ` and ${rows.length - 40} more` : "");
  if (left.typed.length) out.push(`Left alone, and needs a person to look: ${left.typed.length} rows still hold an anonymous person's real name in words someone typed or the script does not know: ${list(left.typed)}`);
  if (left.unknown.length) out.push(`Left alone, and needs a person to look: ${left.unknown.length} app-written rows mention a member's name outside a known wording (often a title or an excerpt): ${list(left.unknown)}`);
  return out.join("\n");
}

async function backUp(db, file) {
  if (fs.existsSync(file)) throw new Error("The backup file is already there. Give a new file name; a backup is never overwritten.");
  fs.writeFileSync(file, "", { flag: "wx", mode: 0o600 }); // it holds everyone's data, so it is private from the start
  await db.backup(file);
  const copy = new Database(file);
  try {
    copy.pragma("journal_mode = DELETE"); // one file, with no -wal or -shm beside it to forget
    if (copy.pragma("quick_check", { simple: true }) !== "ok") throw new Error("The backup did not pass its check, so nothing was changed.");
  } finally { copy.close(); }
}

async function main(args) {
  let apply = false, backup = "", file = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--backup" && args[i + 1] && !args[i + 1].startsWith("-")) backup = args[++i];
    else if (!args[i].startsWith("-") && !file) file = args[i];
    else throw new Error(`Did not understand ${args[i]}. Nothing was changed.`);
  }
  if (apply && !backup) throw new Error("--apply needs --backup FILE, a new file to copy the database to first. Nothing was changed.");
  file = path.resolve(file || process.env.DATABASE_PATH || "./data/connect.db");
  const db = new Database(file, { readonly: !apply, fileMustExist: true, timeout: 30000 });
  try {
    if (!apply) return console.log(report(db.transaction(() => plan(db))(), false));
    for (const t of TABLES)
      if (!db.pragma(`table_info(${t})`).some((c) => c.name === "actor_id"))
        throw new Error("This database has not been opened by the fixed app yet. Deploy it first, then run this. Nothing was changed.");
    await backUp(db, path.resolve(backup));
    db.pragma("secure_delete = ON"); // overwrites what it replaces (what was deleted earlier can linger until a VACUUM)
    const done = db.transaction(() => {
      const p = plan(db);
      for (const c of p.changes) db.prepare(`UPDATE ${c.table} SET text=?, actor_id=? WHERE id=? AND actor_id IS NULL`).run(c.text, c.actor, c.id);
      for (const [table, rows] of Object.entries(p.signals)) for (const id of rows) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      return p;
    }).immediate();
    db.pragma("wal_checkpoint(TRUNCATE)");
    console.log(report(done, true));
    console.log(`Backup: ${path.resolve(backup)} (it still holds the old names: delete it once you are satisfied).`);
  } finally { db.close(); }
}

main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
