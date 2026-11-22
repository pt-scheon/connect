import Link from "next/link";
import { api } from "@/lib/site-data";
import { app, inr, pad2 } from "@/lib/site";
import { Clock } from "@/components/site/clock";
import { ProjectCard } from "@/components/site/project-card";
import { BuilderList } from "@/components/site/builder-list";
import { InterestForm } from "@/components/site/interest-form";
import { currentUser } from "@/lib/auth";
import { Game } from "@/components/site/game";
import { Words } from "@/components/site/words";

// Rendered per request, from the live database.
export const dynamic = "force-dynamic";

/* Two invented profiles that show what a record looks like. Labelled as examples on the page. */
const PROFILES = [
  { head: "Built three things", credit: 111, facts: "3 shipped of 4 joined · worked with 4 people",
    lines: [["Bus tracker, hardware", "Signed by 2 teammates"], ["Fest entry passes, scanner rig", "Signed by 2 teammates"], ["Solar heater logger, firmware", "Signed by 1 teammate"]] },
  { head: "Founder | AI | Web3", credit: 0, facts: "0 shipped of 3 joined · left 3",
    lines: [["Built 10+ full-stack apps", "No proof"], ["Led a 200-member community", "No proof"], ["Canteen pre-order app", "Dropped it"]] },
];
const CAMPUS: [string, string][] = [
  ["Members", "One project board instead of fifty group chats. See who has worked with whom before you say yes."],
  ["Clubs", "A roster the lead confirms each semester. Tap a member to see what they have built."],
  ["Alumni", "Fund a project one milestone at a time. Teams need real credit to apply."],
  ["Recruiters", "Every member has a shareable resume link where each line is signed by the people who were there."],
];

export default async function Home() {
  const me = await currentUser();
  const [o, projects, colleges, builders] = await Promise.all([
    api.overview(), api.projects({ limit: 6 }), api.colleges(), api.builders(6),
  ]);
  const r = o.rules;
  const steps = [
    { t: "Join a team, with a stake", d: `Find a project that needs your skill and ask to join. ${r.stake} of your credit is held until it ships.`, m: `${r.stake} held` },
    { t: "Build, and link the proof", d: "Tick off milestones. Link the live site, the repo, the demo. Write one line on what you did.", m: "Proof linked" },
    { t: `${r.reviewsNeeded} outsiders review it`, d: `People with ${r.reviewerMin}+ credit who were not on the team open the proof and decide what it is worth.`, m: `${r.live} live · ${r.demo} demo` },
    { t: "Teammates split the credit", d: "Each teammate divides the project between the others. Your share is the middle value of what they gave you.", m: "Median share" },
    { t: "It counts on your record", d: `Solo projects earn ${r.soloFactor * 100}%. Credit older than ${r.fadeMonths} months counts half. Every line is signed.`, m: `Starts at ${r.starter}` },
  ];

  return (
    <>
      {/* 1 · Hero */}
      <section id="hero" className="hero">
        <div className="hero-liquid" aria-hidden="true"><span /><span /><span /></div>
        <p className="hero-word" aria-hidden="true">CONNECT</p>
        <div className="hero-foot">
          <h1 className="hero-title" data-reveal>Credit only for what ships.<br />Students build it, teammates sign it.</h1>
          <div className="hero-status mono" data-reveal style={{ ["--d" as string]: "120ms" }}>
            <Clock />
            <span><i className="dot" aria-hidden="true" /> {o.stats.building} project{o.stats.building === 1 ? "" : "s"} being built now.</span>
          </div>
        </div>
      </section>

      {/* 2 · Latest work: shipped projects */}
      <section id="work" className="sec dark">
        <h2 className="mega red" data-reveal>Latest Work</h2>
        <div className="work-list">
          {projects.map((p, i) => <ProjectCard key={p.id} p={p} index={i} />)}
          {projects.length === 0 && <p className="lead">Nothing has shipped yet. The first reviewed project lands here.</p>}
        </div>
        <div className="sec-end"><Link className="btn-line" href="/work">Show all ({o.stats.shipped}) <span aria-hidden="true">→</span></Link></div>
      </section>

      {/* 3 · About */}
      <section id="about" className="sec light">
        <p className="statement" data-words>
          <Words text="Connect is a network of colleges where students build projects together. Each college is its own private space. " />
          <em><Words text="Credit comes only from projects that ship, and teammates and outside reviewers decide what each person earned." /></em>
        </p>
        <div className="sec-end"><Link className="btn-line" href={app.rules}>Read the credit rules <span aria-hidden="true">→</span></Link></div>
      </section>

      {/* 4 · How it works (numbered list) */}
      <section id="how" className="sec dark split">
        <h2 className="title" data-reveal>How it works</h2>
        <ol className="rows">
          {steps.map((s, i) => (
            <li key={s.t} className="row" data-reveal style={{ ["--d" as string]: `${i * 70}ms` }}>
              <span className="row-tile" aria-hidden="true">{pad2(i + 1)}</span>
              <span className="row-main"><span className="row-title">{s.t}</span><span className="row-sub">{s.d}</span></span>
              <span className="mono row-meta">{s.m}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="game" className="sec light split">
        <div className="game-head">
          <h2 className="title" data-reveal>Try to game it</h2>
          <p className="lead">A big bio earns nothing here. Everyone starts at {r.starter} once their college or work email is verified.</p>
        </div>
        <Game />
      </section>

      <section id="record" className="sec dark">
        <h2 className="title" data-reveal>Same community, two profiles</h2>
        <p className="lead versus-lead">These two are examples. On Connect a profile shows the record, so you can tell them apart in five seconds.</p>
        <div className="versus">
          {PROFILES.map((p) => (
            <article key={p.head} className="versus-card" data-reveal>
              <h3>{p.head}</h3>
              <p className="versus-credit">{p.credit}<span className="mono muted"> credit</span></p>
              <p className="mono muted">{p.facts}</p>
              <ul>{p.lines.map(([what, mark]) => <li key={what}><span>{what}</span><span className="mono muted">{mark}</span></li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section id="community" className="sec dark split tight-top">
        <h2 className="title" data-reveal>One place for the whole community</h2>
        <ol className="rows">
          {CAMPUS.map(([t, d], i) => (
            <li key={t} className="row" data-reveal>
              <span className="row-tile" aria-hidden="true">{pad2(i + 1)}</span>
              <span className="row-main"><span className="row-title">{t}</span><span className="row-sub">{d}</span></span>
            </li>
          ))}
        </ol>
      </section>

      {/* 5 · Colleges */}
      <section id="colleges" className="sec dark split tight-top">
        <h2 className="title-sm mono-label">Colleges on Connect</h2>
        <ul className="plain-list">
          {[...colleges].sort((a, b) => Number(!!b.opened) - Number(!!a.opened) || (b.real?.members ?? 0) - (a.real?.members ?? 0) || b.shipped - a.shipped || b.members - a.members).slice(0, 8).map((c) => (
            <li key={c.slug} data-reveal>
              <Link href={`/colleges/${c.slug}`} className="plain-link">
                <span>{c.name}</span>
                <span className="mono muted">{c.opened && c.real ? `${c.real.members} real members` : `sample · ${c.members} members`} →</span>
              </Link>
            </li>
          ))}
          {colleges.length > 8 && (
            <li><Link href="/colleges" className="plain-link plain-more"><span>All colleges</span><span className="mono muted">{colleges.filter((c) => c.opened).length} open, {colleges.filter((c) => !c.opened).length} samples →</span></Link></li>
          )}
        </ul>
      </section>

      {/* 6 · People (index with preview) */}
      <section id="people" className="sec light">
        <div className="sec-head">
          <h2 className="title" data-reveal>People</h2>
          <Link className="btn-line mono-btn" href="/people">All people <span aria-hidden="true">→</span></Link>
        </div>
        <BuilderList builders={builders} />
      </section>

      {/* 7 · Contact / join */}
      <section id="contact" className="sec dark contact">
        <div className="sec-end start"><Link className="btn-line mono-btn" href={me ? "/work?scope=college" : app.signin}>{me ? "Open your college's work" : "Join with your college email"} <span aria-hidden="true">→</span></Link></div>
        <div className="contact-grid">
          <div>
            <h2 className="mono-label">Join</h2>
            <p className="contact-big"><i className="dot" aria-hidden="true" /> Open to every college.</p>
            <h3 className="mono-label">So far</h3>
            <ul className="contact-list">
              <li>{o.stats.members} {o.sample ? "members, mostly invented samples" : "verified members"}</li>
              <li>{o.stats.shipped} projects shipped and reviewed</li>
              {o.stats.committedInr > 0 && <li>{inr(o.stats.committedInr)} committed by alumni</li>}
            </ul>
          </div>
          <div>
            <h2 className="mono-label">Read</h2>
            <ul className="contact-list">
              <li><Link href={app.rules}>Credit rules →</Link></li>
              <li><Link href={app.privacy}>Privacy →</Link></li>
              <li><Link href={app.terms}>Terms →</Link></li>
              <li><Link href={app.cookies}>Cookies →</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="mono-label">Bring Connect to your college</h2>
            <InterestForm signin={app.signin} />
          </div>
        </div>
      </section>
    </>
  );
}
