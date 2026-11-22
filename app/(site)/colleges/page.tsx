import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/site-data";
import { app, year, type College } from "@/lib/site";

// Rendered per request, from the live database.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Colleges", description: "Colleges on Connect. Each one is its own private space." };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Row({ c, i }: { c: College; i: number }) {
  const r = c.opened ? c.real : undefined;
  const sub = r
    ? r.members || r.shipped || r.building || r.alumni
      ? [count(r.members, "real member"), `${r.shipped} shipped`, `${r.building} being built`].join(" · ")
      : "Open to its students. No real members yet."
    : `${count(c.members, "sample member")} · ${c.shipped} shipped · ${c.building} being built`;
  return (
    <li data-reveal style={{ ["--d" as string]: `${Math.min(i, 8) * 70}ms` }}>
      <Link href={`/colleges/${c.slug}`} className="row">
        <span className="row-tile" aria-hidden="true">{c.name[0]}</span>
        <span className="row-main"><span className="row-title">{c.name}</span><span className="row-sub">{sub}</span></span>
        <span className="mono row-meta">{r ? <>Open since {year(c.since)}</> : "Sample"}</span>
      </Link>
    </li>
  );
}

export default async function Colleges() {
  const all = await api.colleges();
  const opened = all.filter((c) => c.opened).sort((a, b) => (b.real?.members ?? 0) - (a.real?.members ?? 0));
  const samples = all.filter((c) => !c.opened);
  return (
    <section className="sec dark page-top">
      <h1 className="mega" data-reveal>Colleges</h1>
      <p className="lead page-lead" data-reveal>Each college is its own private space: board, people, clubs and funding. Only counts and shipped work are public.</p>
      {opened.length > 0 && <>
        <h2 className="mono-label college-group">Open colleges ({opened.length}). Numbers count real people only.</h2>
        <ol className="rows wide">{opened.map((c, i) => <Row key={c.slug} c={c} i={i} />)}</ol>
      </>}
      {samples.length > 0 && <h2 className="mono-label college-group">Sample colleges ({samples.length}). Their people and projects are invented.</h2>}
      <ol className="rows wide">
        {samples.map((c, i) => <Row key={c.slug} c={c} i={i} />)}
        <li className="row muted"><span className="row-main"><span className="row-title">Yours isn’t here?</span><span className="row-sub">A college on an academic domain opens the first time a student proves an email on it. <Link href={app.signin}>Sign in to start yours.</Link></span></span></li>
      </ol>
    </section>
  );
}
