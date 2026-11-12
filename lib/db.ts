import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

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
];

const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "connect.db");

function open() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.exec(SCHEMA);
  for (const [t, c, type] of COLUMNS) {
    const have = (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some((x) => x.name === c);
    if (!have) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
  }
  return d;
}

const g = globalThis as unknown as { __connectDb?: Database.Database };
export const db = g.__connectDb ?? (g.__connectDb = open());

/* Rows come back loosely typed; the schema above is the source of truth. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = any;
export const all = (sql: string, ...args: unknown[]): Row[] => db.prepare(sql).all(...args);
export const get = (sql: string, ...args: unknown[]): Row | undefined => db.prepare(sql).get(...args);
export const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args);
export const now = () => Math.floor(Date.now() / 1000);
export const TABLES = SCHEMA.match(/TABLE IF NOT EXISTS (\w+)/g)!.map((m) => m.slice(20));
