import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { baseDomain, domainOf, guessName, matchCollege, slugify } from "./domains";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, sub TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT, picture TEXT,
  branch TEXT DEFAULT '', grad_year INTEGER, role TEXT DEFAULT 'student', about TEXT DEFAULT '',
  college_email TEXT, verified INTEGER DEFAULT 0, admin INTEGER DEFAULT 0, skills TEXT DEFAULT '',
  resume TEXT, onboarded INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS codes (user_id INTEGER PRIMARY KEY, email TEXT, code TEXT, expires INTEGER, tries INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, pitch TEXT NOT NULL, status TEXT DEFAULT 'recruiting',
  lead_id INTEGER NOT NULL, pot INTEGER DEFAULT 0, created_at INTEGER NOT NULL, shipped_at INTEGER
);
CREATE TABLE IF NOT EXISTS members (
  project_id INTEGER, user_id INTEGER, role TEXT DEFAULT '', did TEXT DEFAULT '',
  status TEXT DEFAULT 'active', stake INTEGER DEFAULT 0, PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, note TEXT DEFAULT '', open INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, role_id INTEGER, project_id INTEGER, user_id INTEGER, status TEXT DEFAULT 'pending', UNIQUE (project_id, user_id));
CREATE TABLE IF NOT EXISTS proofs (id INTEGER PRIMARY KEY, project_id INTEGER, label TEXT, url TEXT);
CREATE TABLE IF NOT EXISTS milestones (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, done INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS reviews (project_id INTEGER, reviewer_id INTEGER, verdict INTEGER, PRIMARY KEY (project_id, reviewer_id));
CREATE TABLE IF NOT EXISTS allocations (project_id INTEGER, from_id INTEGER, to_id INTEGER, pct INTEGER, PRIMARY KEY (project_id, from_id, to_id));
CREATE TABLE IF NOT EXISTS gone_votes (project_id INTEGER, voter_id INTEGER, target_id INTEGER, PRIMARY KEY (project_id, voter_id, target_id));
CREATE TABLE IF NOT EXISTS vouches (from_id INTEGER, to_id INTEGER, created_at INTEGER, PRIMARY KEY (from_id, to_id));
CREATE TABLE IF NOT EXISTS claims (id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT);
CREATE TABLE IF NOT EXISTS clubs (id INTEGER PRIMARY KEY, name TEXT, about TEXT, lead_id INTEGER);
CREATE TABLE IF NOT EXISTS club_members (club_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'Member', confirmed INTEGER DEFAULT 0, PRIMARY KEY (club_id, user_id));
CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, alum_id INTEGER, title TEXT, about TEXT, amount INTEGER, min_credit INTEGER, open INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, call_id INTEGER, project_id INTEGER, status TEXT DEFAULT 'pending', UNIQUE (call_id, project_id));
CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY, project_id INTEGER, alum_id INTEGER, amount INTEGER);
CREATE TABLE IF NOT EXISTS grant_parts (id INTEGER PRIMARY KEY, grant_id INTEGER, title TEXT, amount INTEGER, paid INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS identities (sub TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, text TEXT, href TEXT, seen INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, user_id INTEGER, kind TEXT DEFAULT 'post', text TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, by_id INTEGER, kind TEXT, target_id INTEGER, reason TEXT, open INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS colleges (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, domains TEXT NOT NULL,
  status TEXT DEFAULT 'active', requested_by INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, text TEXT NOT NULL,
  kind TEXT DEFAULT 'text', project_id INTEGER, seen INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages (from_id, to_id, id);
CREATE INDEX IF NOT EXISTS messages_inbox ON messages (to_id, seen);
CREATE TABLE IF NOT EXISTS voice_calls (
  id INTEGER PRIMARY KEY, caller_id INTEGER NOT NULL, callee_id INTEGER NOT NULL, video INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ringing', caller_device TEXT, callee_device TEXT,
  created_at INTEGER NOT NULL, answered_at INTEGER, ended_at INTEGER, ended_by INTEGER
);
CREATE INDEX IF NOT EXISTS voice_calls_people ON voice_calls (callee_id, status);
CREATE TABLE IF NOT EXISTS call_signals (
  id INTEGER PRIMARY KEY, call_id INTEGER NOT NULL, to_id INTEGER NOT NULL, to_device TEXT, type TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS call_signals_to ON call_signals (to_id, id);
CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, files TEXT NOT NULL, text TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
CREATE TABLE IF NOT EXISTS blocks (user_id INTEGER, blocked_id INTEGER, PRIMARY KEY (user_id, blocked_id));
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER);
-- People following a project they are not on; they get its main moments in their inbox.
CREATE TABLE IF NOT EXISTS follows (project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER, PRIMARY KEY (project_id, user_id));
CREATE TABLE IF NOT EXISTS review_log (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, reviewer_id INTEGER NOT NULL, verdict INTEGER, outcome INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_skills (project_id INTEGER, skill TEXT, PRIMARY KEY (project_id, skill));
CREATE TABLE IF NOT EXISTS member_skills (project_id INTEGER, user_id INTEGER, skill TEXT, by_id INTEGER, PRIMARY KEY (project_id, user_id, skill, by_id));
CREATE TABLE IF NOT EXISTS role_skills (role_id INTEGER, skill TEXT, importance INTEGER DEFAULT 2, PRIMARY KEY (role_id, skill));
CREATE TABLE IF NOT EXISTS review_invites (project_id INTEGER, reviewer_id INTEGER, created_at INTEGER, PRIMARY KEY (project_id, reviewer_id));
CREATE TABLE IF NOT EXISTS live_checks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, url TEXT, ok INTEGER, status INTEGER, note TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, college_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT DEFAULT '',
  file_key TEXT, file_name TEXT, file_type TEXT, skills TEXT DEFAULT '', value TEXT DEFAULT '', status TEXT DEFAULT 'pending',
  method TEXT DEFAULT '', teammate_id INTEGER, work_email TEXT, code TEXT, code_expires INTEGER, tries INTEGER DEFAULT 0,
  decided_by INTEGER, note TEXT DEFAULT '', created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS evidence_user ON evidence (user_id);
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY, college_id INTEGER NOT NULL, client_id INTEGER NOT NULL, club_id INTEGER, title TEXT NOT NULL, brief TEXT NOT NULL,
  deadline INTEGER, reward INTEGER NOT NULL, minted INTEGER DEFAULT 0, money INTEGER DEFAULT 0, money_note TEXT DEFAULT '', money_paid INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open', doer_id INTEGER, proof_url TEXT DEFAULT '', rating INTEGER, rating_note TEXT DEFAULT '',
  reviewer_id INTEGER, review_ok INTEGER, dispute_by INTEGER, dispute_reason TEXT DEFAULT '', resolution TEXT DEFAULT '', paid_credit INTEGER,
  hidden INTEGER DEFAULT 0, created_at INTEGER NOT NULL, assigned_at INTEGER, delivered_at INTEGER, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS commissions_college ON commissions (college_id, status);
CREATE TABLE IF NOT EXISTS commission_skills (commission_id INTEGER, skill TEXT, importance INTEGER DEFAULT 2, PRIMARY KEY (commission_id, skill));
CREATE TABLE IF NOT EXISTS commission_apps (id INTEGER PRIMARY KEY, commission_id INTEGER NOT NULL, user_id INTEGER NOT NULL, note TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at INTEGER, UNIQUE (commission_id, user_id));
CREATE TABLE IF NOT EXISTS commission_milestones (id INTEGER PRIMARY KEY, commission_id INTEGER NOT NULL, title TEXT, done INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY, college_id INTEGER, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, amount INTEGER NOT NULL, note TEXT DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS comments_project ON comments (project_id);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, seen);
CREATE INDEX IF NOT EXISTS updates_project ON updates (project_id);
`;

/* Columns added after the first release. Safe to run on every start. */
const COLUMNS: [table: string, column: string, type: string][] = [
  ["users", "suspended", "INTEGER DEFAULT 0"],
  ["users", "email_verified", "INTEGER DEFAULT 0"],
  ["projects", "hidden", "INTEGER DEFAULT 0"],
  ["users", "github", "TEXT DEFAULT ''"],
  ["users", "linkedin", "TEXT DEFAULT ''"],
  ["users", "website", "TEXT DEFAULT ''"],
  ["reviews", "note", "TEXT DEFAULT ''"],
  ["users", "email_notes", "INTEGER DEFAULT 1"],
  ["users", "open_to_join", "INTEGER DEFAULT 0"],
  ["users", "deleted", "INTEGER DEFAULT 0"],
  ["requests", "note", "TEXT DEFAULT ''"],
  // One college per person, project, club and funding call. Everything is scoped by it.
  ["users", "college_id", "INTEGER"],
  ["users", "super", "INTEGER DEFAULT 0"],
  ["projects", "college_id", "INTEGER"],
  ["clubs", "college_id", "INTEGER"],
  ["calls", "college_id", "INTEGER"],
  ["reports", "college_id", "INTEGER"],
  ["codes", "college_name", "TEXT DEFAULT ''"],
  // Chat attachments: one per message, stored on disk under file_key.
  ["messages", "file_key", "TEXT"],
  ["messages", "file_name", "TEXT"],
  ["messages", "file_type", "TEXT"],
  ["messages", "file_size", "INTEGER"],
  ["messages", "file_w", "INTEGER"],
  ["messages", "file_h", "INTEGER"],
  ["messages", "file_secs", "INTEGER"],
  // Rating redesign: how a report ended ('', 'upheld', 'dismissed') and what kind it was.
  ["reports", "result", "TEXT DEFAULT ''"],
  ["reports", "reason_kind", "TEXT DEFAULT ''"],
  ["projects", "live_url", "TEXT DEFAULT ''"],
  ["projects", "invited_at", "INTEGER"], // when reviewers were picked; empty for projects sent for review under the old rule
];

const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "connect.db");

function open() {
  // `next build` runs many workers at once and pre-renders nothing from data, so each gets a private in-memory
  // database instead of all of them racing to create and lock the same file.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    const m = new Database(":memory:");
    m.transaction(() => migrate(m)).immediate();
    return m;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Wait up to 30 seconds for a lock rather than failing: during `next build` several workers open the same file at once.
  const d = new Database(file, { timeout: 30_000 });
  d.pragma("journal_mode = WAL");
  // One write lock around the whole set-up, so two processes opening a fresh file take turns instead of both
  // adding the same column (or the same home college) and one failing with "duplicate column name".
  d.transaction(() => migrate(d)).immediate();
  return d;
}

/* Creates any missing tables and columns. Only ever adds; safe to run on every start. */
function migrate(d: Database.Database) {
  d.exec(SCHEMA);
  for (const [t, c, type] of COLUMNS) {
    const have = (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    if (!have) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
  }
  for (const ix of ["users_college ON users (college_id)", "projects_college ON projects (college_id)", "clubs_college ON clubs (college_id)"])
    d.exec(`CREATE INDEX IF NOT EXISTS ${ix}`);
  assignColleges(d);
  ensureHomeCollege(d);
}

/* The college named in COLLEGE_EMAIL_DOMAIN (and COLLEGE_NAME) always exists, so a brand-new server has one to join. */
function ensureHomeCollege(d: Database.Database) {
  const dom = (process.env.COLLEGE_EMAIL_DOMAIN || "").toLowerCase().trim();
  if (!dom) return;
  const rows = d.prepare("SELECT id, domains FROM colleges").all() as { id: number; domains: string }[];
  if (matchCollege(dom, rows)) return;
  const name = process.env.COLLEGE_NAME || guessName(dom);
  let slug = slugify(name);
  for (let i = 2; d.prepare("SELECT 1 FROM colleges WHERE slug=?").get(slug); i++) slug = `${slugify(name)}-${i}`;
  d.prepare("INSERT INTO colleges (slug, name, domains, status, created_at) VALUES (?,?,?,?,?)").run(slug, name, dom, "active", Math.floor(Date.now() / 1000));
}

/* Upgrades a database from before colleges existed. Each verified college email becomes a college (named from
   its domain; an admin can rename it), people join the college of their email, and projects, clubs and calls
   follow the person who started them. Anyone left over joins the first college. Runs once: only rows with no
   college are touched. */
function assignColleges(d: Database.Database) {
  const q = <T = Record<string, unknown>>(sql: string, ...a: unknown[]) => d.prepare(sql).all(...a) as T[];
  if (!q("SELECT 1 FROM users WHERE college_id IS NULL AND onboarded=1 AND (verified=1 OR role='alum') LIMIT 1").length
    && !q("SELECT 1 FROM projects WHERE college_id IS NULL LIMIT 1").length) return;
  d.transaction(() => {
    const now = Math.floor(Date.now() / 1000);
    const make = (domain: string, name: string) => {
      const base = slugify(name);
      let slug = base;
      for (let i = 2; q("SELECT 1 FROM colleges WHERE slug=?", slug).length; i++) slug = `${base}-${i}`;
      return Number(d.prepare("INSERT INTO colleges (slug, name, domains, status, created_at) VALUES (?,?,?,?,?)")
        .run(slug, name, domain, "active", now).lastInsertRowid);
    };
    const colleges = () => q<{ id: number; domains: string }>("SELECT id, domains FROM colleges");
    const envDomain = (process.env.COLLEGE_EMAIL_DOMAIN || "").toLowerCase();
    if (envDomain && !matchCollege(envDomain, colleges())) make(envDomain, process.env.COLLEGE_NAME || guessName(envDomain));
    for (const u of q<{ id: number; college_email: string }>("SELECT id, college_email FROM users WHERE college_id IS NULL AND college_email IS NOT NULL")) {
      const dom = domainOf(u.college_email);
      if (!dom) continue;
      const c = matchCollege(dom, colleges())?.id ?? make(baseDomain(dom), dom.endsWith(".example") ? "Demo College" : guessName(dom));
      d.prepare("UPDATE users SET college_id=? WHERE id=?").run(c, u.id);
    }
    const first = colleges()[0]?.id ?? (q("SELECT 1 FROM users LIMIT 1").length ? make(envDomain || "college.example", envDomain ? guessName(envDomain) : "Demo College") : null);
    if (first) {
      // Alumni and anyone else onboarded join the first college; unverified students wait until they prove an email.
      d.prepare("UPDATE users SET college_id=? WHERE college_id IS NULL AND onboarded=1 AND (role='alum' OR verified=1)").run(first);
      for (const t of ["projects", "clubs"]) d.exec(`UPDATE ${t} SET college_id=(SELECT college_id FROM users WHERE id=${t}.lead_id) WHERE college_id IS NULL`);
      d.exec("UPDATE calls SET college_id=(SELECT college_id FROM users WHERE id=calls.alum_id) WHERE college_id IS NULL");
      for (const t of ["projects", "clubs", "calls"]) d.prepare(`UPDATE ${t} SET college_id=? WHERE college_id IS NULL`).run(first);
    }
    // People listed in ADMIN_EMAILS run the whole site.
    for (const e of (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean))
      d.prepare("UPDATE users SET super=1, admin=1 WHERE lower(email)=? AND email_verified=1").run(e);
  })();
}

const g = globalThis as unknown as { __connectDb?: Database.Database; __connectSchema?: string };
const shape = SCHEMA + JSON.stringify(COLUMNS);
export const db = g.__connectDb ?? (g.__connectDb = open());
// In development the connection outlives code reloads. If the tables or columns above changed since it was opened, add them now.
if (g.__connectSchema !== shape) {
  if (g.__connectSchema !== undefined || process.env.NODE_ENV !== "production") migrate(db);
  g.__connectSchema = shape;
}

/* Rows come back loosely typed; the schema above is the source of truth. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = any;
export const all = (sql: string, ...args: unknown[]): Row[] => db.prepare(sql).all(...args);
export const get = (sql: string, ...args: unknown[]): Row | undefined => db.prepare(sql).get(...args);
export const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args);
export const now = () => Math.floor(Date.now() / 1000);
export const TABLES = SCHEMA.match(/TABLE IF NOT EXISTS (\w+)/g)!.map((m) => m.slice(20));
