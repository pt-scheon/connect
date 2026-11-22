/* Starts the server in the container. A test copy (DEMO_MODE=1 on a staging or demo address) that has no database yet
   starts with the invented one built into the image. Anywhere else this only starts the server. */
const fs = require("node:fs");
const path = require("node:path");

const file = process.env.DATABASE_PATH || "/data/connect.db";
const built = path.join(__dirname, "fake-db");
let test = false;
try { test = process.env.DEMO_MODE === "1" && /(^|[.-])(staging|demo)([.-])|(^|\.)localhost$/.test(new URL(process.env.APP_URL).hostname); } catch { /* no address: not a test copy */ }
if (test && !fs.existsSync(file) && fs.existsSync(path.join(built, "connect.db"))) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.cpSync(built, path.dirname(file), { recursive: true });
  console.log("Started with the invented test database.");
}
require("./server.js");
