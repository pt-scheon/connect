/* Runs after `next build` (npm run build): the standalone server must carry no private files. Next copies .env and
   .env.production into it whatever next.config.ts says, so those two copies come out. The excludes there keep out the
   rest, but they do not reach proxy.ts or instrumentation.ts, so anything private still in it fails the build.
   Nothing else is ever deleted: a mistake here must not cost anyone their data. */
const fs = require("node:fs");
const path = require("node:path");

const next = path.join(__dirname, "..", ".next");
const out = path.join(fs.realpathSync(next), "standalone"); // not followed if it is a link: that leads out of the build
// The app sits deeper inside standalone when Next finds a lockfile in a folder above this one.
const app = fs.realpathSync(path.join(out, require(path.join(next, "required-server-files.json")).relativeAppDir));
if (!(app + path.sep).startsWith(out + path.sep)) throw new Error(`Not touching ${app}: it is outside the standalone build.`);

for (const name of [".env", ".env.production"]) fs.rmSync(path.join(app, name), { force: true });

const found = fs.readdirSync(app).filter((name) => /^(data|uploads|db)$|^\.env|\.(db|sqlite)/i.test(name));
if (found.length) {
  console.error(`The standalone build holds private files (${found.join(", ")}). Do not copy or upload .next/standalone: keep them out of file tracing (next.config.ts), then build again.`);
  process.exit(1);
}
