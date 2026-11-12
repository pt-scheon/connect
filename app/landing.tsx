import Link from "next/link";
import { get } from "@/lib/db";
import { RULES } from "@/lib/credit";
import { Count, Simulator } from "./client";
import { Stamp, inr } from "./ui";
import { SignInButtons } from "./signin/buttons";

/* What a signed-out visitor sees. */
export function Landing() {
  const shipped = get("SELECT COUNT(*) n FROM projects WHERE status='shipped' AND hidden=0").n;
  const students = get("SELECT COUNT(*) n FROM users WHERE role='student' AND verified=1 AND suspended=0").n;
  const money = get("SELECT COALESCE(SUM(amount),0) n FROM grants").n;
  const steps: [string, string][] = [
    ["Join a team, with a stake", `Find a project that needs your skill and ask to join. ${RULES.stake} of your credit is held until it ships.`],
    ["Build, and link the proof", "Tick off milestones. Link the live site, the repo, the demo. Write one line on what you did."],
    ["Two outsiders review it", `People who were not on the team open the proof and decide what it is worth: ${RULES.live}, ${RULES.demo}, or not ready.`],
    ["Teammates split the credit", "Each teammate divides the project between the others. You never set your own share."],
  ];
  return (
    <>
      <section className="hero">
        <div className="stack" style={{ gap: 18 }}>
          <h1>Build with people from your college. Earn credit only for <em>what ships</em>.</h1>
          <p className="lead">Connect is where you find a team, ship a project, and leave with a record your teammates signed. A big bio earns nothing here.</p>
          <SignInButtons large />
          <span className="small muted">Free for students. One account per college email, and each college is its own private space. <Link href="/colleges">See the colleges</Link>.</span>
        </div>
        <Simulator />
      </section>

      {shipped + students > 0 && (
        <div className="card"><div className="stats">
          <div className="stat"><b><Count to={students} /></b><span className="small muted">verified students</span></div>
          <div className="stat"><b><Count to={shipped} /></b><span className="small muted">projects shipped and reviewed</span></div>
          {money > 0 && <div className="stat"><b>{inr(money)}</b><span className="small muted">committed by alumni</span></div>}
        </div></div>
      )}

      <section className="section">
        <h2>How a project becomes credit</h2>
        <div className="grid steps">{steps.map(([t, d]) => <div key={t} className="card"><h3>{t}</h3><p>{d}</p></div>)}</div>
      </section>

      <section className="section">
        <h2>Same college, two profiles</h2>
        <p className="muted" style={{ maxWidth: "62ch" }}>These two are examples. On Connect a profile shows the record, so you can tell them apart in five seconds.</p>
        <div className="versus">
          <div className="card">
            <div className="row between"><h3>Built three things</h3><span className="bal">111 credit</span></div>
            <span className="mono small muted">3 shipped of 4 joined · worked with 4 people</span>
            <div className="row between small"><span>Bus tracker · hardware</span><Stamp>Signed by 2 teammates</Stamp></div>
            <div className="row between small"><span>Fest entry passes · scanner rig</span><Stamp>Signed by 2 teammates</Stamp></div>
            <div className="row between small"><span>Solar heater logger · firmware</span><Stamp>Signed by 1 teammate</Stamp></div>
          </div>
          <div className="card">
            <div className="row between"><h3>Founder | AI | Web3</h3><span className="bal">0 credit</span></div>
            <span className="mono small muted">0 shipped of 3 joined · <span className="neg">left 3</span></span>
            <div className="row between small"><span className="muted">Built 10+ full-stack apps</span><Stamp kind="no">No proof</Stamp></div>
            <div className="row between small"><span className="muted">Led a 200-member community</span><Stamp kind="no">No proof</Stamp></div>
            <div className="row between small"><span>Canteen pre-order app</span><Stamp kind="bad">Dropped it</Stamp></div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>One place for the whole campus</h2>
        <div className="grid">
          <div className="card"><h3>Students</h3><p>One project board instead of fifty group chats. See who has worked with whom before you say yes.</p></div>
          <div className="card"><h3>Clubs</h3><p>A roster the lead confirms each semester. Tap a member to see what they have built.</p></div>
          <div className="card"><h3>Alumni</h3><p>Fund a student project one milestone at a time. Teams need real credit to apply.</p></div>
          <div className="card"><h3>Recruiters</h3><p>Every student has a shareable resume link where each line is signed by the people who were there.</p></div>
        </div>
        <div className="row"><Link className="btn lg" href="/signin">Get started</Link><Link href="/rules">Read the credit rules</Link></div>
      </section>
    </>
  );
}
