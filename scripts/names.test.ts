/* Nobody's name is frozen into stored text: activity, notices and team chat show the name each person goes by now,
   so anonymous mode and account deletion reach lines written earlier. Run with: npm test. Throwaway database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ACTORS, CAST, LINES, assertGone, assertNamedNow, world } from "./names-world";

test("going anonymous takes the real name out of every line written before it", async () => {
  const w = await world();
  for (const who of ACTORS) await w.anonymous(who);
  for (const who of ACTORS) await assertGone(w, CAST[who], `${who}, anonymous`);
  await assertNamedNow(w, "anonymous");
});

test("deleting an account takes the name out of activity, team chat and other people's inboxes", async () => {
  for (const who of ACTORS) {
    const w = await world();
    await w.remove(who);
    assert.equal(w.u(who).name, "Deleted user");
    await assertGone(w, CAST[who], `${who}, deleted`);
    await assertNamedNow(w, `${who}, deleted`);
  }
});

test("someone who was anonymous and deletes their account leaves neither name nor alias", async () => {
  for (const who of ["lead", "joiner", "alum"] as const) {
    const w = await world({ anonymous: [who] });
    const alias = w.u(who).name as string;
    await w.remove(who);
    await assertGone(w, CAST[who], `${who}, anonymous then deleted`);
    await assertGone(w, alias, `${who}'s alias after deletion`);
  }
});

test("a new alias replaces the old one in lines written under it", async () => {
  const w = await world({ anonymous: ACTORS });
  const before = new Map(ACTORS.map((who) => [who, w.u(who).name as string]));
  for (const who of ACTORS) await w.anonymous(who, true, true);
  for (const who of ACTORS) {
    assert.notEqual(w.u(who).name, before.get(who));
    await assertGone(w, before.get(who)!, `${who}'s old alias`);
    await assertGone(w, CAST[who], `${who}, new alias`);
  }
  await assertNamedNow(w, "new alias");
});

test("anonymous on, off and on again: the same lines follow the person each time", async () => {
  const w = await world();
  await assertNamedNow(w, "as posted", (by) => CAST[by]);
  for (const who of ACTORS) await w.anonymous(who, true);
  await assertNamedNow(w, "on");
  for (const who of ACTORS) await w.anonymous(who, false);
  await assertNamedNow(w, "off", (by) => CAST[by]);
  for (const who of ACTORS) await w.anonymous(who, true);
  await assertNamedNow(w, "on again");
  for (const who of ACTORS) await assertGone(w, CAST[who], `${who}, on again`);
});

test("a call that is ringing, or being joined, goes on under the new name", async () => {
  const w = await world();
  await w.anonymous("lead");
  await w.anonymous("mate");
  const ring = JSON.parse(w.get("SELECT payload FROM call_signals WHERE type='ring'")!.payload);
  assert.equal(ring.from.name, w.u("lead").name);
  assert.equal(ring.from.picture, w.u("lead").picture);
  assert.equal(ring.from.id, w.id.lead, "the rest of the signal is as it was");
  const joined = JSON.parse(w.get("SELECT payload FROM team_signals WHERE type='joined' AND from_id=?", w.id.mate)!.payload);
  assert.equal(joined.name, w.u("mate").name);
  assert.equal(joined.user, w.id.mate);
});

test("lines are stored without anyone's name, anonymous or not", async () => {
  const w = await world();
  assert.equal(LINES.length, 32, "every writer is exercised");
  const stored = w.cells().filter((c) => /^(updates|notifications|team_messages)\.text#/.test(c.at));
  for (const name of Object.values(CAST)) assert.deepEqual(stored.filter((c) => c.value.includes(name)).map((c) => c.at), [], name);
});

test("what people type is shown as typed, even when it looks like a name slot", async () => {
  const w = await world();
  const A = await import("../app/actions");
  await w.act("lead", A.postUpdate, { id: w.pid, text: "{name} posted the project" });
  await w.act("watcher", A.postComment, { id: w.pid, text: "{name} here, is it open?" });
  const s = await w.seen();
  assert.ok(s.project.includes("{name} posted the project"));
  assert.ok(s.inboxes.lead.includes(`${CAST.watcher} asked about Kite: {name} here, is it open?`));
});

test("an email copy of a notice carries the name shown at the time, not a slot", async () => {
  const w = await world({ anonymous: ["lead"] });
  const { notify } = await import("../lib/notify");
  const bodies: string[] = [], real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { bodies.push(String(init?.body)); return new Response("{}"); }) as typeof fetch;
  process.env.RESEND_API_KEY = "test-only";
  try {
    const A = await import("../app/actions");
    const fan = w.id.watcher;
    w.run("INSERT INTO members (project_id, user_id) VALUES ((SELECT id FROM projects WHERE name='Lantern'),?)", fan);
    await w.act("lead", A.vouch, { to: fan });
    notify(fan, "Kite shipped", "/projects/1"); // a line about nobody
  } finally {
    delete process.env.RESEND_API_KEY;
    globalThis.fetch = real;
  }
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].includes(`${w.u("lead").name} vouched for you`), bodies[0]);
  assert.ok(!bodies[0].includes(CAST.lead) && !bodies[0].includes("{name}"), bodies[0]);
  assert.ok(bodies[1].includes("Kite shipped"));
});

test("no code builds stored text out of a person's name", () => {
  const found: string[] = [];
  for (const dir of ["app", "lib"])
    for (const f of fs.readdirSync(path.join(process.cwd(), dir), { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(f)) continue;
      fs.readFileSync(path.join(process.cwd(), dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/\b(notify|logUpdate|systemLine)\(/.test(line) && /\$\{[^}]*\b(me!?|who|by|them!?|caller|actor)(\??\.name)?\s*\}|SELECT name FROM users/.test(line))
          found.push(`${dir}/${f}:${i + 1}`);
      });
    }
  assert.deepEqual(found, [], "use NAME from lib/identity and pass the person's id");
});
