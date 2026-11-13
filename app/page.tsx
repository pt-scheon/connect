import Link from "next/link";
import { redirect } from "next/navigation";
import { all, now } from "@/lib/db";
import { currentUser, standings } from "@/lib/auth";
import { collegeById, isMember } from "@/lib/college";
import { EMPTY, RULES } from "@/lib/credit";
import { ties, pathTo } from "@/lib/graph";
import { timeAgo } from "@/lib/notify";
import { fitFor } from "@/lib/match";
import { Board, Count, type BoardItem } from "./client";
import { Landing } from "./landing";
import { Av, skillsOf } from "./ui";

export default async function Home({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const me = await currentUser();
  if (!me) return <Landing />;
  if (!me.onboarded || !isMember(me)) redirect("/onboarding");
  const cid = me.college_id, college = collegeById(cid)!;
  const S = standings(), mine = S.get(me.id) ?? EMPTY;
  const canReview = !!me.verified && (!!me.admin || mine.earned >= RULES.reviewerMin);

  const members = all("SELECT m.project_id, u.id, u.name, u.picture FROM members m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE m.status='active' AND p.college_id=?", cid);
  const roles = all("SELECT r.project_id, r.title FROM roles r JOIN projects p ON p.id=r.project_id WHERE r.open=1 AND p.college_id=?", cid);
  const ms = new Map(all("SELECT project_id, COUNT(*) total, SUM(done) done FROM milestones GROUP BY project_id").map((m) => [m.project_id, m]));
  const funded = new Set(all("SELECT project_id FROM grants").map((g) => g.project_id));
  const last = new Map(all("SELECT project_id, MAX(created_at) t FROM updates GROUP BY project_id").map((x) => [x.project_id, x.t]));
  const mySkills = me.role === "student" ? skillsOf(me) : [];
  const items: BoardItem[] = all("SELECT * FROM projects WHERE college_id=? ORDER BY created_at DESC", cid)
    .map((p) => {
      const team = members.filter((m) => m.project_id === p.id).map(({ id, name, picture }) => ({ id, name, picture }));
      const open = roles.filter((r) => r.project_id === p.id).map((r) => r.title);
      const t = Math.max(last.get(p.id) ?? 0, p.created_at ?? 0);
      const live = p.status === "recruiting" || p.status === "building";
      return {
        id: p.id, name: p.name, pitch: p.pitch, status: p.status, hidden: p.hidden,
        done: ms.get(p.id)?.done ?? 0, total: ms.get(p.id)?.total ?? 0, team,
        open, funded: funded.has(p.id), mine: team.some((u) => u.id === me.id),
        fit: [...new Set(open.flatMap((r) => fitFor(r, mySkills)))],
        active: live && t ? timeAgo(t) : "", quiet: live && t > 0 && now() - t > 14 * 86400,
      };
    })
    .filter((p) => !p.hidden || p.mine || me.admin);

  // People two steps away: shipped with someone you shipped with.
  const T = ties();
  const names = new Map(all("SELECT id, name FROM users WHERE college_id=?", cid).map((u) => [u.id, u.name]));
  const near = all("SELECT * FROM users WHERE role='student' AND verified=1 AND suspended=0 AND college_id=? AND id<>?", cid, me.id)
    .filter((u) => !T.get(me.id)?.has(u.id))
    .map((u) => ({ u, path: pathTo(T, me.id, u.id, names) }))
    .filter((x) => !x.path.startsWith("No one"))
    .slice(0, 3);
  const feed = all(
    `SELECT up.*, p.name FROM updates up JOIN projects p ON p.id=up.project_id
     WHERE p.hidden=0 AND p.status<>'dropped' AND p.college_id=? ORDER BY up.created_at DESC, up.id DESC LIMIT 8`, cid);

  return (
    <>
      <div className="head">
        <div className="stack tight">
          <span className="label college-tag">{college.name}</span>
          <h1>Projects on campus</h1>
          <p>One board for everyone at {college.name}, and only them. Every project shows who is on it, what is built so far and what it still needs.</p>
        </div>
        {me.role === "student" && <Link className="btn" href="/projects/new">Post a project</Link>}
      </div>
      {me.role === "student" && (() => {
            const steps: [boolean, string, string][] = [
              [!!me.verified, "Verify your college email", "/onboarding"],
              [!!(me.skills && (me.github || me.linkedin)), "Add your skills and a GitHub or LinkedIn link", "/onboarding?edit=1"],
              [mine.joined > 0, "Join a project or post your own", items.some((p) => p.open.length) ? "/?f=open" : "/projects/new"],
              [mine.shipped > 0, "Ship it and get it reviewed", "/credit"],
            ];
            const left = steps.filter((x) => !x[0]).length;
            if (!left) return null;
            return (
              <div className="card start">
                <span className="label">Getting started · {steps.length - left} of {steps.length}</span>
                <span className="meter"><b style={{ width: `${(100 * (steps.length - left)) / steps.length}%` }} /></span>
                <div className="steps-row">
                {steps.map(([ok, label, href]) => (
                  <Link key={label} href={href} className={`step ${ok ? "ok" : ""}`}>
                    <span aria-hidden="true">{ok ? "✓" : "○"}</span>{label}
                  </Link>
                ))}
                </div>
              </div>
            );
          })()}
      <div className="cols">
        <Board items={items} canReview={canReview} initial={(await searchParams).f ?? "all"} />
        <aside className="stack">
          {me.role === "student" && (
            <div className="card">
              <span className="label">Your standing</span>
              <div className="stat"><b><Count to={mine.credit} /></b><span className="muted small">credit</span></div>
              <span className="small muted">{mine.shipped} shipped of {mine.joined} joined</span>
              <Link href="/credit">See your ledger</Link>
            </div>
          )}
          {feed.length > 0 && (
            <div className="card">
              <span className="label">Happening on campus</span>
              <div className="feed">
                {feed.map((x) => (
                  <div key={x.id} className={`item ${x.kind === "post" ? "post" : x.text.startsWith("Shipped") ? "ship" : ""}`}>
                    <span className="dot" />
                    <span><Link href={`/projects/${x.project_id}`}>{x.name}</Link> <span className="muted">· {timeAgo(x.created_at)}</span><br />{x.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {near.length > 0 && (
            <div className="card">
              <span className="label">People you could build with</span>
              {near.map(({ u, path }) => (
                <div key={u.id} className="row nowrap" style={{ alignItems: "start" }}>
                  <Av u={u} />
                  <div className="stack" style={{ gap: 2 }}><Link href={`/u/${u.id}`}>{u.name}</Link><span className="small muted">{path}</span></div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
