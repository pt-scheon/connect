import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { requireUser, standings } from "@/lib/auth";
import { EMPTY, RULES, projectShares } from "@/lib/credit";
import { timeAgo } from "@/lib/notify";
import { suggest } from "@/lib/match";
import { skillsOf } from "../../ui";
import * as A from "../../actions";
import { ProofHelp, SplitForm } from "../../client";
import { F, Meter, Pill, Stamp, UserLink, Who, inr, monthYear } from "../../ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = get("SELECT name, pitch FROM projects WHERE id=? AND hidden=0", Number((await params).id));
  return p ? { title: p.name, description: p.pitch } : { title: "Project" };
}

export default async function Project({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const id = Number((await params).id);
  const p = get("SELECT * FROM projects WHERE id=?", id);
  if (!p) notFound();
  const back = `/projects/${id}`;
  const S = standings();

  const team = all("SELECT m.role mrole, m.did, m.status mstatus, m.stake, u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY m.rowid", id);
  const active = team.filter((t) => t.mstatus === "active");
  const mine = team.find((t) => t.id === me.id);
  if (p.hidden && !mine && !me.admin) notFound();
  const comments = all("SELECT c.*, u.name, u.picture, u.id uid FROM comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? ORDER BY c.created_at, c.id", id);
  const updates = all("SELECT up.*, u.name uname FROM updates up LEFT JOIN users u ON u.id=up.user_id WHERE up.project_id=? ORDER BY up.created_at DESC, up.id DESC LIMIT 30", id);
  const onTeam = mine?.mstatus === "active";
  const lead = p.lead_id === me.id;
  const open = p.status === "recruiting" || p.status === "building";
  const shipped = p.status === "shipped";

  const roles = all("SELECT * FROM roles WHERE project_id=? AND open=1", id);
  // For the lead: people who might fit each open role, best proof first.
  const invited = new Set<string>(lead ? all("SELECT user_id, text FROM notifications WHERE href=? AND text LIKE '%invited you%'", `/projects/${id}`)
    .map((nn) => `${nn.user_id}:${nn.text}`) : []);
  const asked = new Set<number>(all("SELECT user_id FROM requests WHERE project_id=?", id).map((q) => q.user_id));
  const pool = lead ? all("SELECT * FROM users WHERE role='student' AND verified=1 AND suspended=0 AND onboarded=1")
    .filter((u) => !team.some((t) => t.id === u.id) && !asked.has(u.id))
    .map((u) => { const st = S.get(u.id) ?? EMPTY; return { u, c: { id: u.id, skills: skillsOf(u), credit: st.credit, shipped: st.shipped, left: st.left } }; }) : [];
  const fits = new Map(roles.map((r) => [r.id, suggest(r.title, pool.map((x) => x.c)).map((sg) => ({ ...sg, u: pool.find((x) => x.u.id === sg.id)!.u, st: S.get(sg.id) ?? EMPTY }))]));
  const myRequest = get("SELECT * FROM requests WHERE project_id=? AND user_id=?", id, me.id);
  const requests = lead ? all("SELECT q.id rid, r.title, u.* FROM requests q JOIN roles r ON r.id=q.role_id JOIN users u ON u.id=q.user_id WHERE q.project_id=? AND q.status='pending'", id) : [];
  const proofs = all("SELECT * FROM proofs WHERE project_id=?", id);
  const ms = all("SELECT * FROM milestones WHERE project_id=?", id);
  const done = ms.filter((m) => m.done).length;
  const reviews = all("SELECT reviewer_id FROM reviews WHERE project_id=?", id);
  const grant = get("SELECT g.*, u.name alum_name, u.grad_year FROM grants g JOIN users u ON u.id=g.alum_id WHERE g.project_id=?", id);
  const parts = grant ? all("SELECT * FROM grant_parts WHERE grant_id=?", grant.id) : [];
  const sh = shipped ? projectShares(id) : new Map<number, number>();
  const solo = active.length === 1;
  const myAllocs = new Map(all("SELECT to_id, pct FROM allocations WHERE project_id=? AND from_id=?", id, me.id).map((a) => [a.to_id, a.pct]));
  const myVotes = new Set(all("SELECT target_id FROM gone_votes WHERE project_id=? AND voter_id=?", id, me.id).map((v) => v.target_id));
  const canReview = p.status === "review" && !mine && me.verified && (me.admin || (S.get(me.id)?.credit ?? 0) >= RULES.reviewerMin);
  const iReviewed = reviews.some((r) => r.reviewer_id === me.id);
  const missing = [
    !proofs.length && "a proof link",
    done < ms.length && "every milestone ticked",
    active.some((t) => !t.did) && "each teammate's “what I did”",
  ].filter(Boolean);

  return (
    <>
      <Link href="/">← All projects</Link>
      <div className="head">
        <div className="stack tight">
          <div className="row"><h1>{p.name}</h1><Pill status={p.status} /></div>
          <p>{p.pitch}</p>
          {lead && open && (
            <details className="small">
              <summary className="muted" style={{ cursor: "pointer" }}>Edit name and description</summary>
              <F action={A.editProject} back={back} hidden={{ id }} className="stack tight" >
                <input type="text" name="name" id="edit-name" defaultValue={p.name} maxLength={60} required aria-label="Project name" />
                <input type="text" name="pitch" id="edit-pitch" defaultValue={p.pitch} maxLength={300} required aria-label="What it does" />
                <div><button className="btn ghost sm">Save</button></div>
              </F>
            </details>
          )}
          <span className="small muted mono">{shipped ? `Shipped ${monthYear(p.shipped_at)}` : `Started ${monthYear(p.created_at)}`}</span>
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          {p.hidden ? <div className="alert">Hidden by an admin. Only the team and admins can see this project.</div> : null}
          {p.status === "dropped" && <div className="alert">Dropped by its lead before it shipped. This stays on the lead&apos;s profile.</div>}

          {p.status === "review" && (
            <div className="card">
              <h2>In review</h2>
              <p className="muted">{reviews.length} of {RULES.reviewsNeeded} reviews in. Reviewers are people outside the team with {RULES.reviewerMin}+ credit. They open the proof and decide what this is worth. The stricter verdict wins.</p>
              {canReview && <ProofHelp id={id} action={A.summariseProof} />}
              {canReview && (
                <F action={A.reviewProject} back={back} hidden={{ id }} className="stack tight">
                  <textarea name="note" id="review-note" maxLength={400} placeholder="A note for the team: what you checked, and what is missing if it is not ready. Shown without your name." style={{ minHeight: 70 }} />
                  <div className="row">
                    <button className="btn" name="verdict" value={RULES.live}>Live and in use</button>
                    <button className="btn ghost" name="verdict" value={RULES.demo}>Works, demo only</button>
                    <button className="btn danger" name="verdict" value={0}>Not ready</button>
                  </div>
                </F>
              )}
              {iReviewed && <span className="small muted">You have reviewed this. Picking again replaces your verdict.</span>}
            </div>
          )}

          <div className="card">
            <h2>Team</h2>
            <div className="tw"><table className="stack-sm"><tbody>
              <tr><th>Who</th><th>Role</th><th>What they did</th>{shipped && <><th className="n">Share</th><th className="n">Credit</th></>}{open && onTeam && <th />}</tr>
              {team.map((t) => {
                const gone = t.mstatus === "left";
                const pct = sh.get(t.id) ?? 0;
                return (
                  <tr key={t.id}>
                    <td><Who u={t} /></td>
                    <td data-label="Role">{gone ? <Stamp kind="bad">Left mid-project</Stamp> : t.mrole}</td>
                    <td className={`wide ${t.did ? "" : "muted"}`}>{gone ? (t.stake ? `Stake of ${t.stake} lost` : "") : t.did || "Not written yet"}</td>
                    {shipped && <><td className="n" data-label="Share">{gone ? "0%" : `${Math.round(pct)}%`}</td>
                      <td className="n" data-label="Credit">{gone ? (t.stake ? `−${t.stake}` : "0") : `+${Math.round(p.pot * pct / 100 * (solo ? RULES.soloFactor : 1))}`}</td></>}
                    {open && onTeam && <td className="n">
                      {!gone && t.id !== me.id && t.id !== p.lead_id && (myVotes.has(t.id) ? <span className="small muted">Marked</span>
                        : <F action={A.voteGone} back={back} hidden={{ id, target: t.id }} confirm={`Mark ${t.name.split(" ")[0]} as gone?`}><button className="linkbtn small">Mark as gone</button></F>)}
                    </td>}
                  </tr>
                );
              })}
            </tbody></table></div>
            {shipped && <p className="small muted">{solo ? "Solo projects have no teammates to sign, so they earn half the pot."
              : `Pot of ${p.pot}. Shares are the middle value of what each teammate gave the others. Nobody sets their own.`}</p>}
          </div>

          {onTeam && !shipped && p.status !== "dropped" && (
            <F action={A.saveContribution} back={back} hidden={{ id }} className="card">
              <h2>Your part</h2>
              <div className="row">
                <input type="text" name="role" id="role" defaultValue={mine.mrole} placeholder="Your role" style={{ flex: "0 1 180px" }} />
                <input type="text" name="did" id="did" defaultValue={mine.did} placeholder="What you built, in one line" maxLength={200} />
                <button className="btn ghost">Save</button>
              </div>
              <span className="small muted">Your teammates see this when they split the credit. It becomes a line on your resume.</span>
            </F>
          )}

          {shipped && onTeam && !solo && (
            <SplitForm action={A.allocate} back={back} id={id} saved={myAllocs.size > 0}
              mates={active.filter((t) => t.id !== me.id).map((t) => ({ id: t.id, name: t.name, did: t.did, pct: myAllocs.get(t.id) ?? Math.round(100 / (active.length - 1)) }))} />
          )}

          {(roles.length > 0 || (lead && open)) && (
            <div className="card">
              <h2>Open roles</h2>
              {roles.map((r) => (
                <div key={r.id} className="row between">
                  <div className="stack" style={{ gap: 2 }}><b>{r.title}</b>{r.note && <span className="small muted">{r.note}</span>}</div>
                  {lead ? <F action={A.closeRole} back={back} hidden={{ role: r.id }}><button className="btn ghost sm">Close role</button></F>
                    : mine ? <span className="small muted">{onTeam ? "You are on this team" : "You left this project"}</span>
                    : myRequest?.status === "pending" ? (myRequest.role_id === r.id
                        ? <F action={A.withdrawRequest} back={back} hidden={{ id }}><button className="btn ghost">Withdraw request</button></F> : null)
                    : myRequest ? <span className="small muted">Your request was declined</span>
                    : me.role === "student" ? <F action={A.requestJoin} back={back} hidden={{ role: r.id }}><button className="btn">Ask to join · stake {RULES.stake}</button></F> : null}
                  {lead && (fits.get(r.id)?.length ?? 0) > 0 && (
                    <div className="suggest">
                      <span className="label">People who might fit</span>
                      {fits.get(r.id)!.map((sg) => {
                        const done = [...invited].some((k) => k.startsWith(`${sg.id}:`) && k.includes(r.title));
                        return (
                          <div key={sg.id} className="row between">
                            <span className="stack" style={{ gap: 0 }}>
                              <Who u={sg.u} />
                              <span className="small muted">{sg.matched.join(", ")} · {sg.backed ? `${sg.st.shipped} shipped` : "listed, not yet shipped"} · {sg.st.credit} credit</span>
                            </span>
                            {done ? <span className="small muted">Invited</span>
                              : <F action={A.inviteToRole} back={back} hidden={{ role: r.id, to: sg.id }}><button className="btn ghost sm">Invite to apply</button></F>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {!lead && roles.length > 0 && <p className="small muted">Joining holds {RULES.stake} of your credit. You get it back when the project ships. If you leave or the team marks you as gone, you lose it.</p>}
              {lead && open && (
                <F action={A.addRole} back={back} hidden={{ id }} className="row">
                  <input type="text" name="title" id="role-title" placeholder="Role, e.g. Backend (Node)" required />
                  <input type="text" name="note" id="role-note" placeholder="Note (optional)" />
                  <button className="btn ghost">Add role</button>
                </F>
              )}
            </div>
          )}

          {requests.length > 0 && (
            <div className="card">
              <h2>Join requests</h2>
              {requests.map((u) => {
                const s = S.get(u.id) ?? EMPTY;
                return (
                  <div key={u.rid} className="row between">
                    <div className="stack" style={{ gap: 2 }}>
                      <span><UserLink u={u} /> <span className="muted small">for {u.title}</span></span>
                      <span className="small mono muted">{s.credit} credit · {s.shipped} shipped of {s.joined} joined{s.left ? <span className="neg"> · left {s.left}</span> : null}</span>
                    </div>
                    <div className="row">
                      <F action={A.answerRequest} back={back} hidden={{ request: u.rid, answer: "accept" }}><button className="btn sm">Accept</button></F>
                      <F action={A.answerRequest} back={back} hidden={{ request: u.rid, answer: "decline" }}><button className="btn ghost sm">Decline</button></F>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {lead && open && (
            <div className="card">
              <h2>Ship it</h2>
              {missing.length ? <p className="muted">Before review you still need: {missing.join(", ")}.</p>
                : <p className="muted">Everything is in place. Two people outside the team will open your proof and decide what it is worth.</p>}
              <div className="row">
                <F action={A.submitForReview} back={back} hidden={{ id }}><button className="btn" disabled={missing.length > 0}>Send for review</button></F>
                <F action={A.dropProject} back={back} hidden={{ id }} confirm="Drop this project for good?"><button className="btn danger">Drop project · lose {RULES.stake}</button></F>
              </div>
            </div>
          )}
          {onTeam && !lead && open && (
            <F action={A.leaveProject} back={back} hidden={{ id }} confirm="Leave this project?"><button className="btn danger sm">Leave project{mine.stake ? ` · lose your ${mine.stake} stake` : ""}</button></F>
          )}

          <div className="card" id="questions">
            <h2>Questions</h2>
            <p className="small muted">Ask the team anything before you join. The team&apos;s answers are marked.</p>
            {comments.length === 0 && <span className="small muted">No questions yet.</span>}
            <div className="stack tight">
              {comments.map((c) => {
                const fromTeam = active.some((t) => t.id === c.uid);
                return (
                  <div key={c.id} className={`comment ${fromTeam ? "team" : ""}`}>
                    <div className="row between">
                      <span className="row nowrap"><Who u={{ id: c.uid, name: c.name, picture: c.picture }} />{fromTeam && <span className="pill info">Team</span>}</span>
                      <span className="row small muted">{timeAgo(c.created_at)}
                        {(c.uid === me.id || me.admin) ? <F action={A.deleteComment} back={back} hidden={{ comment: c.id }} confirm="Delete this?"><button className="linkbtn small">Delete</button></F> : null}</span>
                    </div>
                    <p className="pre">{c.text}</p>
                  </div>
                );
              })}
            </div>
            {me.verified && p.status !== "dropped" ? (
              <F action={A.postComment} back={back} hidden={{ id }} className="row">
                <input type="text" name="text" id="comment-text" maxLength={500} placeholder={onTeam ? "Answer a question or add a note" : "Ask the team a question"} required />
                <button className="btn ghost">Post</button>
              </F>
            ) : null}
          </div>

          <div className="card">
            <h2>Updates</h2>
            {onTeam && p.status !== "dropped" && (
              <F action={A.postUpdate} back={back} hidden={{ id }} className="row">
                <input type="text" name="text" id="update-text" maxLength={280} placeholder="What moved this week?" required />
                <button className="btn ghost">Post</button>
              </F>
            )}
            {updates.length === 0 && <span className="small muted">No updates yet.</span>}
            <div className="feed">
              {updates.map((x) => (
                <div key={x.id} className={`item ${x.kind === "post" ? "post" : x.text.startsWith("Shipped") ? "ship" : ""}`}>
                  <span className="dot" />
                  <span>{x.kind === "post" && <b>{x.uname}: </b>}{x.text} <span className="muted small">· {timeAgo(x.created_at)}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <span className="label">Proof</span>
            {proofs.length === 0 && <span className="small muted">Nothing linked yet.</span>}
            {proofs.map((x) => (
              <div key={x.id} className="row between small">
                <a href={x.url} target="_blank" rel="noopener noreferrer nofollow">{x.label} ↗</a>
                {onTeam && open && <F action={A.removeProof} back={back} hidden={{ proof: x.id }}><button className="linkbtn small">Remove</button></F>}
              </div>
            ))}
            {shipped && <span><Stamp>Reviewed · pot {p.pot}</Stamp></span>}
            {onTeam && open && (
              <F action={A.addProof} back={back} hidden={{ id }} className="stack tight">
                <input type="text" name="label" id="proof-label" placeholder="Live site, repo, demo video…" required />
                <input type="url" name="url" id="proof-url" placeholder="https://" required />
                <button className="btn ghost sm">Add proof</button>
              </F>
            )}
          </div>

          <div className="card">
            <span className="label">Milestones</span>
            <div className="row"><Meter done={done} total={ms.length} /><span className="small muted mono">{done}/{ms.length}</span></div>
            {ms.map((m) => (
              <div key={m.id} className="row between small">
                <span className={m.done ? "" : "muted"}>{m.done ? "✓" : "○"} {m.title}</span>
                {onTeam && open && <F action={A.toggleMilestone} back={back} hidden={{ milestone: m.id }}><button className="linkbtn small">{m.done ? "Undo" : "Done"}</button></F>}
              </div>
            ))}
            {lead && open && (
              <F action={A.addMilestone} back={back} hidden={{ id }} className="row">
                <input type="text" name="title" id="ms-title" placeholder="New milestone" required />
                <button className="btn ghost sm">Add</button>
              </F>
            )}
          </div>

          {grant && (
            <div className="card">
              <span className="label">Alumni funding</span>
              <div className="stat"><b>{inr(grant.amount)}</b><span className="small muted">from <Link href={`/u/${grant.alum_id}`}>{grant.alum_name}</Link>, class of {grant.grad_year}</span></div>
              {parts.map((x) => (
                <div key={x.id} className="row between small">
                  <span>{x.title}</span>
                  <span className="mono">{inr(x.amount)} <span className={`pill ${x.paid ? "ok" : "warn"}`}>{x.paid ? "Paid" : "Held"}</span></span>
                </div>
              ))}
            </div>
          )}
          {me.admin ? (
            <F action={A.setHidden} back={back} hidden={{ id, on: p.hidden ? 0 : 1 }}><button className="btn ghost sm">{p.hidden ? "Admin: show project" : "Admin: hide project"}</button></F>
          ) : null}
          {!mine && me.verified ? (
            <details className="small">
              <summary className="muted" style={{ cursor: "pointer" }}>Report this project</summary>
              <F action={A.report} back={back} hidden={{ kind: "project", target: id }} className="stack tight">
                <input type="text" name="reason" id="report-reason" placeholder="What is wrong?" maxLength={300} required />
                <button className="btn ghost sm">Send to admins</button>
              </F>
            </details>
          ) : null}
        </aside>
      </div>
    </>
  );
}
