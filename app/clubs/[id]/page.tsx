import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { currentUser, requireMember, standings } from "@/lib/auth";
import { EMPTY } from "@/lib/credit";
import * as A from "../../actions";
import { F, Pill, Who } from "../../ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  const c = me?.verified ? get("SELECT name, about FROM clubs WHERE id=? AND college_id=?", Number((await params).id), me.college_id) : null;
  return c ? { title: c.name, description: c.about } : { title: "Club" };
}

export default async function Club({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const id = Number((await params).id);
  const c = get("SELECT * FROM clubs WHERE id=? AND college_id=?", id, me.college_id);
  if (!c) notFound();
  const back = `/clubs/${id}`;
  const S = standings();
  const rows = all("SELECT cm.role crole, cm.confirmed, u.* FROM club_members cm JOIN users u ON u.id=cm.user_id WHERE cm.club_id=? ORDER BY (u.id=?) DESC, u.name", id, c.lead_id);
  const members = rows.filter((r) => r.confirmed), waiting = rows.filter((r) => !r.confirmed);
  const boss = c.lead_id === me.id || !!me.admin;
  const mine = rows.find((r) => r.id === me.id);
  // Projects where at least two confirmed members are on the team.
  const projects = all(
    `SELECT p.id, p.name, p.status FROM projects p JOIN members m ON m.project_id=p.id AND m.status='active'
     JOIN club_members cm ON cm.user_id=m.user_id AND cm.club_id=? AND cm.confirmed=1
     WHERE p.status<>'dropped' GROUP BY p.id HAVING COUNT(*)>=2 ORDER BY p.created_at DESC`, id);

  return (
    <>
      <Link href="/clubs">← All clubs</Link>
      <div className="head">
        <div className="stack tight"><h1>{c.name}</h1><p>{c.about}</p></div>
        {!mine && me.role === "student" && <F action={A.joinClub} back={back} hidden={{ club: id }}><button className="btn">Ask to join</button></F>}
        {mine && !mine.confirmed && <span className="pill warn">Waiting for the lead</span>}
      </div>
      <div className="card">
        <h2>Members</h2>
        <div className="tw"><table className="stack-sm"><tbody>
          <tr><th>Member</th><th>Role</th><th className="n">Shipped</th><th className="n">Credit</th>{boss && <th />}</tr>
          {members.map((u) => {
            const s = S.get(u.id) ?? EMPTY;
            return (
              <tr key={u.id}>
                <td><Who u={u} /></td>
                <td>{boss && u.id !== c.lead_id ? (
                  <F action={A.setClubMember} back={back} hidden={{ club: id, user: u.id, do: "confirm" }} className="row nowrap">
                    <input type="text" name="role" id={`role-${u.id}`} defaultValue={u.crole} aria-label={`Role for ${u.name}`} style={{ flex: "0 1 160px" }} />
                    <button className="linkbtn small">Save</button>
                  </F>) : u.crole}</td>
                <td className="n" data-label="Shipped">{s.shipped}/{s.joined}</td>
                <td className="n" data-label="Credit">{s.earned}</td>
                {boss && <td className="n">{u.id !== c.lead_id && <F action={A.setClubMember} back={back} hidden={{ club: id, user: u.id, do: "remove" }}><button className="linkbtn small">Remove</button></F>}</td>}
              </tr>
            );
          })}
        </tbody></table></div>
        <p className="small muted">The club lead confirms every member and role. Membership gives no credit. Club projects earn it the same way as any other.</p>
      </div>
      {boss && waiting.length > 0 && (
        <div className="card">
          <h2>Waiting to join</h2>
          {waiting.map((u) => (
            <div key={u.id} className="row between">
              <Who u={u} />
              <div className="row">
                <F action={A.setClubMember} back={back} hidden={{ club: id, user: u.id, do: "confirm", role: "Member" }}><button className="btn sm">Confirm</button></F>
                <F action={A.setClubMember} back={back} hidden={{ club: id, user: u.id, do: "remove" }}><button className="btn ghost sm">Decline</button></F>
              </div>
            </div>
          ))}
        </div>
      )}
      {projects.length > 0 && (
        <div className="card">
          <h2>Projects by members</h2>
          {projects.map((p) => <div key={p.id} className="row between"><Link href={`/projects/${p.id}`}>{p.name}</Link><Pill status={p.status} /></div>)}
        </div>
      )}
    </>
  );
}
