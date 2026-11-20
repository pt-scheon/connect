/* Team chat rules. Run with: npm test. Uses a throwaway database, never the real one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "connect-team-")), "test.db");

test("only the current team is on it, messages carry name, role and lead tags, and unread counts work", async () => {
  const { run, now, TABLES } = await import("../lib/db");
  const { onTeam, teamMessages, systemLine, markTeamRead, unreadTeam, teamOf } = await import("../lib/teamchat");
  for (const t of TABLES) run(`DELETE FROM ${t}`);
  for (const [id, name] of [[1, "Riya Patil"], [2, "Arjun Mane"], [3, "Kabir Shaikh"], [4, "Outsider"]] as const)
    run("INSERT INTO users (id, sub, name, verified, onboarded, created_at) VALUES (?,?,?,1,1,?)", id, `t:${id}`, name, now());
  const pid = Number(run("INSERT INTO projects (name, pitch, lead_id, created_at) VALUES ('Attend','x',1,?)", now()).lastInsertRowid);
  run("INSERT INTO members (project_id, user_id, role) VALUES (?,1,'Lead'),(?,2,'Backend'),(?,3,'Design')", pid, pid, pid);

  assert.ok(onTeam(pid, 2));
  assert.ok(!onTeam(pid, 4), "someone not on the team cannot read it");
  assert.deepEqual(teamOf(pid).map((u) => [u.name, u.role, !!u.lead]), [["Riya Patil", "Lead", true], ["Arjun Mane", "Backend", false], ["Kabir Shaikh", "Design", false]]);

  run("INSERT INTO team_messages (project_id, user_id, text, created_at) VALUES (?,1,'Kickoff at 6',?)", pid, now());
  run("INSERT INTO team_messages (project_id, user_id, text, created_at) VALUES (?,2,'API is up',?)", pid, now());
  const seenByArjun = teamMessages(pid, 2);
  assert.equal(seenByArjun[0].from?.lead, true);
  assert.equal(seenByArjun[1].from?.role, "Backend");
  assert.equal(seenByArjun[1].mine, true);
  assert.equal(seenByArjun[0].mine, false);

  assert.equal(unreadTeam(pid, 3), 2, "Kabir has two new messages");
  assert.equal(unreadTeam(pid, 2), 1, "your own messages never count as new");
  markTeamRead(pid, 3);
  assert.equal(unreadTeam(pid, 3), 0);

  run("UPDATE members SET status='left' WHERE project_id=? AND user_id=3", pid);
  systemLine(pid, "Kabir Shaikh left the team");
  assert.ok(!onTeam(pid, 3), "leaving the team ends access");
  const after = teamMessages(pid, 1);
  assert.equal(after.at(-1)?.kind, "system");
  assert.equal(after.at(-1)?.from, null);
  run("INSERT INTO team_messages (project_id, user_id, text, created_at) VALUES (?,3,'old note',?)", pid, now() - 10);
  assert.equal(teamMessages(pid, 1).find((m) => m.text === "old note")?.from?.gone, true, "a former member's messages say so");
});
