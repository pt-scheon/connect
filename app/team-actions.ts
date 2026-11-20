"use server";

import { get, run, now, type Row } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isMember } from "@/lib/college";
import { allow } from "@/lib/notify";
import { markTeamRead, onTeam, teamMessages, type TeamMsg } from "@/lib/teamchat";
export type { TeamMsg } from "@/lib/teamchat";

/* Team chat: only the project's current team, at the same college. */
async function teammate(projectId: number): Promise<Row | null> {
  const me = await currentUser();
  if (!me?.onboarded || !isMember(me)) return null;
  const p = get("SELECT id FROM projects WHERE id=? AND college_id=?", Math.trunc(Number(projectId)) || 0, me.college_id);
  return p && onTeam(p.id, me.id) ? me : null;
}

/* New messages after `after`, and marks the chat read. The chat calls this every few seconds. */
export async function loadTeamChat(projectId: number, after: number): Promise<{ messages: TeamMsg[] } | { error: string }> {
  const me = await teammate(projectId);
  if (!me) return { error: "Only the team can open this chat." };
  const messages = teamMessages(projectId, me.id, Math.max(0, Math.trunc(Number(after)) || 0));
  if (messages.length || !after) markTeamRead(projectId, me.id);
  return { messages };
}

export async function sendTeamMessage(projectId: number, text: string): Promise<{ message: TeamMsg } | { error: string }> {
  const me = await teammate(projectId);
  if (!me) return { error: "Only the team can write here." };
  const body = String(text ?? "").trim().slice(0, 2000);
  if (!body) return { error: "Write something first." };
  if (!allow(`team:${me.id}`, 40, 60)) return { error: "You are sending a lot. Wait a minute." };
  const id = Number(run("INSERT INTO team_messages (project_id, user_id, text, created_at) VALUES (?,?,?,?)", projectId, me.id, body, now()).lastInsertRowid);
  markTeamRead(projectId, me.id);
  return { message: teamMessages(projectId, me.id, id - 1, 1)[0] };
}
