/* The guard that keeps tests off the real database (lib/db-path.ts). Run with: npm test.
   Everything here happens in throwaway folders, so a broken guard has nothing real to harm. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-guard-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");

test("a test gets a throwaway database and uploads folder, and nothing else", async () => {
  const { dbFile } = await import("../lib/db-path");
  const { uploadDir } = await import("../lib/files");
  const own = process.env.DATABASE_PATH!;
  assert.equal(dbFile(), own);
  assert.equal(uploadDir(), path.join(dir, "uploads"));
  try {
    for (const bad of [
      null, "", "data/connect.db", "./data/connect.db", ":memory:",
      "/data/connect.db", "/srv/connect-live/connect.db", // a server's, whatever its folder is called
      path.join(os.tmpdir(), "backup", "connect.db"), path.join(dir, "..", "connect.db"), // in temp, but nobody's throwaway
      path.join(dir, "data", "connect.db"), // a checkout that is itself in temp
    ]) {
      if (bad === null) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = bad;
      assert.throws(dbFile, /throwaway database/, String(bad));
      assert.throws(uploadDir, /throwaway database/, String(bad));
    }
  } finally {
    process.env.DATABASE_PATH = own;
  }
});

test("however a test is started, it cannot open ./data/connect.db", () => {
  const home = fs.mkdtempSync(path.join(dir, "checkout-"));
  const real = path.join(home, "data", "connect.db");
  fs.mkdirSync(path.dirname(real));
  fs.writeFileSync(real, "not to be opened");
  const load = `require(${JSON.stringify(path.join(__dirname, "../lib/db.ts"))});`;
  fs.writeFileSync(path.join(home, "loads.test.ts"), load);
  fs.writeFileSync(path.join(home, "loads.ts"), load);

  const env = { ...process.env };
  delete env.DATABASE_PATH;
  delete env.NODE_TEST_CONTEXT;
  const tsx = pathToFileURL(require.resolve("tsx")).href;
  for (const [how, args] of [
    ["by the runner", ["--test", "loads.ts"]],
    ["all in one process", ["--test", "--experimental-test-isolation=none", "loads.ts"]],
    ["by hand", ["loads.test.ts"]],
  ] as const) {
    const r = spawnSync(process.execPath, ["--import", tsx, ...args], { cwd: home, env, encoding: "utf8", timeout: 30_000 });
    assert.notEqual(r.status, 0, how);
    assert.match(r.stdout + r.stderr, /throwaway database/, how);
    assert.equal(fs.readFileSync(real, "utf8"), "not to be opened", how);
    assert.deepEqual(fs.readdirSync(path.dirname(real)), ["connect.db"], how);
  }
});
