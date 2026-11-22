import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { timeAgo } from "@/lib/notify";
import { scopeFor } from "@/lib/scope";
import { collegeWork, publicWork } from "@/lib/directory";
import { Count } from "@/app/client";
import { Shortcuts } from "@/app/shortcuts";
import { ShareLink } from "@/app/(app)/messages/media";
import { ScopeLinks } from "@/components/site/scope-links";
import { WorkBoard } from "@/components/site/work-board";
import { Avatar } from "@/components/site/avatar";
import { Name } from "@/components/site/name";

// Rendered per request, from the live database.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Work", description: "Every project shipped on Connect and reviewed by people outside the team. Members also see everything being built at their college." };

/* Below this many verified students, the board asks people to bring their classmates. */
const INVITE_UNTIL = 25;

export default async function Work({ searchParams }: { searchParams: Promise<{ scope?: string; f?: string }> }) {
  const me = await currentUser(), sp = await searchParams;
  const { view, college } = scopeFor(me, sp.scope);
  const board = me && college ? collegeWork(me, college) : null;
  const inside = view === "college" && board && college && me ? { ...board, college, me } : null;
  const items = inside ? inside.items : publicWork(board?.items);
  const student = inside?.me.role === "student";

  const steps: [boolean, string, string][] = inside && student ? [
    [!!inside.me.verified, "Verify your college or work email", "/onboarding"],
    [!!(inside.me.skills && (inside.me.github || inside.me.linkedin)), "Add your skills and a GitHub or LinkedIn link", "/onboarding?edit=1"],
    [inside.standing.joined > 0, "Join a project or post your own", inside.items.some((p) => p.board?.open.length) ? "/work?scope=college&f=open" : "/projects/new"],
    [inside.standing.shipped > 0, "Ship it and get it reviewed", "/credit"],
  ] : [];
  const todo = steps.filter((s) => !s[0]).length;

  return (
    <>
      <section className="sec dark page-top">
        <ScopeLinks base="/work" view={view} member={!!college} />
        <h1 className="mega red" data-reveal>Work <sup className="mega-count">({items.filter((p) => p.board?.status !== "dropped").length})</sup></h1>
        {me?.onboarded && !college && <p className="tool-note">{me.role === "alum" ? "Your alumni account is waiting for an admin of your community to approve it." : <span>Your community&rsquo;s projects stay hidden until you <a href="/onboarding">prove your college or work email</a>.</span>}</p>}
        <p className="lead page-lead" data-reveal>
          {inside
            ? `One board for everyone at ${inside.college.name}, and only them. Every project shows who is on it, what is built so far and what it still needs.`
            : "Every project here shipped: two people outside the team opened the proof and signed off on it."}
        </p>
        {inside && student && (
          <div className="work-head">
            <a className="solid" href="/projects/new">Post a project</a>
            <p className="work-standing">
              <span><b><Count to={inside.standing.credit} /></b> credit</span>
              <span>{inside.standing.shipped} shipped of {inside.standing.joined} joined</span>
              <a href="/credit">See your ledger</a>
            </p>
          </div>
        )}
        {todo > 0 && (
          <div className="work-start">
            <span className="mono muted">Getting started · {steps.length - todo} of {steps.length}</span>
            <ul>{steps.map(([ok, label, href]) => <li key={label} className={ok ? "ok" : undefined}><a href={href}><span aria-hidden="true">{ok ? "✓" : "○"}</span> {label}</a></li>)}</ul>
          </div>
        )}
        <WorkBoard key={`${view}:${sp.f ?? ""}`} items={items} view={view} forYou={inside?.forYou} canReview={inside?.canReview} initial={sp.f} />
      </section>

      {inside && (inside.updates.length > 0 || inside.near.length > 0 || inside.classmates < INVITE_UNTIL) && (
        <section className="sec light work-side">
          {inside.updates.length > 0 && (
            <div>
              <h2 className="mono-label">Happening in your community</h2>
              <ul>{inside.updates.map((x) => <li key={x.id}><a href={`/projects/${x.project_id}`}>{x.name}</a> <span className="mono muted">{timeAgo(x.created_at)}</span><p>{x.text}</p></li>)}</ul>
            </div>
          )}
          {inside.near.length > 0 && (
            <div>
              <h2 className="mono-label">People you could build with</h2>
              <ul>{inside.near.map((u) => <li key={u.id} className="work-near"><Avatar name={u.name} src={u.picture} /><div><a href={`/u/${u.id}`}><Name name={u.name} /></a><p>{u.path}</p></div></li>)}</ul>
            </div>
          )}
          {inside.classmates < INVITE_UNTIL && (
            <div>
              <h2 className="mono-label">{inside.college.name} is new on Connect</h2>
              <p>{inside.classmates <= 1 ? "You are the first one here." : `${inside.classmates} members are here so far.`} A board works when the rest of your community is on it. Send them the link.</p>
              <ShareLink path={`/colleges/${inside.college.slug}`} title={`${inside.college.name} on Connect`} text={`Join ${inside.college.name} on Connect: find teammates and earn credit only for what ships.`} label="Invite your community" />
            </div>
          )}
        </section>
      )}
      <Shortcuts />
    </>
  );
}
