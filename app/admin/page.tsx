import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import * as A from "../actions";
import { F, Who } from "../ui";

export default async function Admin() {
  const me = await requireUser();
  if (!me.admin) notFound();
  const alumni = all("SELECT * FROM users WHERE role='alum' AND verified=0 AND onboarded=1");
  const students = all("SELECT id, name, branch FROM users WHERE role='student' AND verified=1 ORDER BY name");
  const review = all("SELECT * FROM projects WHERE status='review'");
  const reports = all("SELECT r.*, u.name by_name FROM reports r JOIN users u ON u.id=r.by_id WHERE r.open=1 ORDER BY r.id DESC");
  const label = (r: { kind: string; target_id: number }) =>
    r.kind === "user" ? all("SELECT name FROM users WHERE id=?", r.target_id)[0]?.name : all("SELECT name FROM projects WHERE id=?", r.target_id)[0]?.name;
  const suspended = all("SELECT * FROM users WHERE suspended=1");
  return (
    <>
      <div className="head"><div className="stack tight"><h1>Admin</h1><p>Approve alumni, register clubs, and clear the review queue. One admin review is enough to ship a project.</p></div></div>
      <div className="grid">
        <div className="card">
          <h2>Alumni waiting</h2>
          {alumni.length === 0 && <span className="muted">No one is waiting.</span>}
          {alumni.map((u) => (
            <div key={u.id} className="row between">
              <span className="stack" style={{ gap: 0 }}><Who u={u} /><span className="small muted">{u.branch}, class of {u.grad_year} · {u.email}</span></span>
              <F action={A.approveAlum} back="/admin" hidden={{ user: u.id }}><button className="btn sm">Approve</button></F>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Projects in review</h2>
          {review.length === 0 && <span className="muted">The queue is empty.</span>}
          {review.map((p) => <Link key={p.id} href={`/projects/${p.id}`}>{p.name}</Link>)}
        </div>
        <div className="card">
          <h2>Reports</h2>
          {reports.length === 0 && <span className="muted">No open reports.</span>}
          {reports.map((r) => (
            <div key={r.id} className="stack tight">
              <span><Link href={r.kind === "user" ? `/u/${r.target_id}` : `/projects/${r.target_id}`}>{label(r) ?? "Removed"}</Link> <span className="small muted">reported by {r.by_name}</span></span>
              <span className="small">{r.reason}</span>
              <div className="row">
                {r.kind === "user"
                  ? <F action={A.setSuspended} back="/admin" hidden={{ user: r.target_id, on: 1 }} confirm="Suspend this person?"><button className="btn danger sm">Suspend</button></F>
                  : <F action={A.setHidden} back="/admin" hidden={{ id: r.target_id, on: 1 }}><button className="btn danger sm">Hide project</button></F>}
                <F action={A.closeReport} back="/admin" hidden={{ report: r.id }}><button className="btn ghost sm">Close report</button></F>
              </div>
            </div>
          ))}
          {suspended.length > 0 && <span className="label">Suspended</span>}
          {suspended.map((u) => (
            <div key={u.id} className="row between"><span>{u.name}</span><F action={A.setSuspended} back="/admin" hidden={{ user: u.id, on: 0 }}><button className="btn ghost sm">Restore</button></F></div>
          ))}
        </div>
        <F action={A.createClub} back="/admin" className="card stack">
          <h2>Register a club</h2>
          <input type="text" name="name" id="club-name" placeholder="Club name" required />
          <input type="text" name="about" id="club-about" placeholder="What the club does" />
          <select name="lead" id="club-lead" required defaultValue="">
            <option value="" disabled>Pick the lead</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.branch})</option>)}
          </select>
          <div><button className="btn">Register</button></div>
        </F>
      </div>
    </>
  );
}
