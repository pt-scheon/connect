/* Import this before anything that reaches lib/db: imports run first, so setting the path in the test file is too late. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "connect-test-")), "test.db");
