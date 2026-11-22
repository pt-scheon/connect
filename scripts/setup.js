/* A working database of invented people, projects, clubs and pictures, for a fresh clone and for test copies.

     npm run setup                      installs the website's packages, then makes data/connect.db
     node scripts/setup.js --db-only    only the database (at DATABASE_PATH, if set)

   A database that already has people in it is left untouched. Nothing here contains a real person. */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const run = (cmd, cwd = root, env = process.env) => execSync(cmd, { cwd, env, stdio: "inherit" });
if (!process.argv.includes("--db-only") && !fs.existsSync(path.join(root, "frontend", "node_modules"))) run("npm ci", path.join(root, "frontend"));

const file = path.resolve(root, process.env.DATABASE_PATH || "data/connect.db");
function people() {
  if (!fs.existsSync(file)) return 0;
  const db = new (require("better-sqlite3"))(file, { readonly: true });
  try {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get() ? db.prepare("SELECT COUNT(*) n FROM users").get().n : 0;
  } finally { db.close(); }
}
const n = people();
if (n) console.log(`The database already has ${n} people, so it was left untouched.`);
else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const env = { ...process.env, DATABASE_PATH: file, ADMIN_EMAILS: "", COLLEGE_EMAIL_DOMAIN: "" };
  run("npx tsx scripts/seed.ts", root, env); // creates the tables, so it goes first
  run("node scripts/demo-data.js", root, env);
  run("node scripts/sample-art.js", root, env);
}
