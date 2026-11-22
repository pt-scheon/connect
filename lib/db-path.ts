import os from "os";
import path from "path";

/* Where the database is; uploads are kept next to it (lib/files.ts). A test may only have a throwaway one, in a
   "connect-" folder of its own in the temp directory, and is refused anything else before it is opened: the tests
   empty every table. */

// The test runner marks the processes it starts, or keeps --test when it runs everything in one. A test file run by
// hand has only its name to go by.
const testing = () =>
  !!process.env.NODE_TEST_CONTEXT || process.execArgv.includes("--test") || /[\\/.]test\.[cm]?[jt]sx?$/.test(process.argv[1] ?? "");

function throwaway(file: string) {
  const dir = path.dirname(path.resolve(file));
  return path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith("connect-");
}

export function dbFile() {
  // turbopackIgnore: without it `next build` traces this path and copies the database into .next/standalone.
  const file = process.env.DATABASE_PATH || path.join(/* turbopackIgnore: true */ process.cwd(), "data", "connect.db");
  if (testing() && !throwaway(file))
    throw new Error(`Tests may only use a throwaway database, not ${file}. Set DATABASE_PATH to a file in fs.mkdtempSync(path.join(os.tmpdir(), "connect-")) before loading lib/db.`);
  return file;
}
