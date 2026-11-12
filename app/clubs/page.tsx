import Link from "next/link";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Av } from "../ui";

export const metadata = { title: "Clubs" };

export default async function Clubs() {
  const me = await requireUser();
  const clubs = all("SELECT * FROM clubs ORDER BY name");
  const members = all("SELECT cm.club_id, u.* FROM club_members cm JOIN users u ON u.id=cm.user_id WHERE cm.confirmed=1");
  return (
    <>
      <div className="head"><div className="stack tight">
        <h1>Clubs</h1>
        <p>Each club keeps its roster here. Open a member to see what they have built.</p>
      </div></div>
      {clubs.length === 0 && <div className="note">No clubs registered yet. {me.admin ? <Link href="/admin">Register one</Link> : "An admin registers clubs and names each lead."}</div>}
      <div className="grid">
        {clubs.map((c) => {
          const m = members.filter((x) => x.club_id === c.id);
          return (
            <Link key={c.id} className="card" href={`/clubs/${c.id}`}>
              <h2>{c.name}</h2>
              <span className="muted">{c.about}</span>
              <span className="row between"><span className="avs">{m.slice(0, 8).map((u) => <Av key={u.id} u={u} />)}</span><span className="small muted">{m.length} member{m.length === 1 ? "" : "s"}</span></span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
