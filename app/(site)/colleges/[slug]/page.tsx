import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/site-data";
import { app } from "@/lib/site";
import { currentUser } from "@/lib/auth";
import { collegeById } from "@/lib/college";
import { ProjectCard } from "@/components/site/project-card";

// Rendered per request, from the live database.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await api.college((await params).slug);
  return c ? { title: c.name, description: `${c.name} on Connect: members who build and ship together.` } : { title: "College" };
}

export default async function CollegePage({ params }: Props) {
  const c = await api.college((await params).slug);
  if (!c) notFound();
  const me = await currentUser();
  const here = !!me?.verified && collegeById(me.college_id)?.slug === c.slug;
  const real = c.opened ? c.real : undefined;
  const n = real ?? c.counts;
  const stats: [number, string][] = [[n.members, real ? "real members" : "sample members"], [n.shipped, "projects shipped"], [n.building, "being built now"], [n.alumni, "alumni backing projects"]];
  return (
    <>
      <section className="sec dark page-top">
        <Link href="/colleges" className="mono back">← All colleges</Link>
        <p className="mono muted college-kind">{real ? "Open on Connect. These numbers count real people only." : "Sample college. Its people and numbers are invented."}</p>
        <h1 className="mega" data-reveal>{c.name}</h1>
        <p className="lead page-lead" data-reveal>Only people with a verified {c.domains.map((d) => `@${d}`).join(" or ")} email get in.</p>
        <dl className="stats">
          {stats.map(([n, l], i) => <div key={l} data-reveal style={{ ["--d" as string]: `${i * 70}ms` }}><dd>{n}</dd><dt className="mono">{l}</dt></div>)}
        </dl>
      </section>
      <section className="sec dark tight-top">
        <h2 className="title" data-reveal>{real && c.shipped.length > real.shipped ? "Shipped here, including samples" : "Shipped here"}</h2>
        <div className="work-list">{c.shipped.map((p, i) => <ProjectCard key={p.id} p={p} index={i} />)}</div>
        {c.shipped.length === 0 && <p className="lead">Nothing shipped yet.</p>}
        <div className="sec-end start">{here
          ? <Link className="btn-line mono-btn" href="/work">Open the board <span aria-hidden="true">→</span></Link>
          : <Link className="btn-line mono-btn" href={me ? "/onboarding" : app.signin}>{me ? "Prove your email to join" : `Join ${c.name}`} <span aria-hidden="true">→</span></Link>}</div>
      </section>
    </>
  );
}
