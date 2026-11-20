import { notFound } from "next/navigation";
import { get } from "@/lib/db";
import { requireMember } from "@/lib/auth";
import { markTeamRead, onTeam, teamMessages, teamOf } from "@/lib/teamchat";
import { TeamChat } from "../team-chat";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const p = get("SELECT name FROM projects WHERE id=? AND college_id=?", Number((await params).id), me.college_id);
  return { title: p ? `${p.name} · Team chat` : "Team chat" };
}

/* A project's team chat. Only its current team: anyone else, admins included, gets "not found". */
export default async function TeamChatPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const id = Number((await params).id);
  const p = get("SELECT id, name FROM projects WHERE id=? AND college_id=?", id, me.college_id);
  if (!p || !onTeam(p.id, me.id)) notFound();
  const initial = teamMessages(p.id, me.id);
  markTeamRead(p.id, me.id);
  const team = teamOf(p.id).map((u) => ({ id: u.id as number, name: String(u.name), picture: u.picture ?? null, role: String(u.role || "Member"), lead: !!u.lead }));
  return (
    <div className="team-chat-wrap">
      <TeamChat project={p.id} name={p.name} team={team} initial={initial} />
    </div>
  );
}
