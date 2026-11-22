import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { scopeFor } from "@/lib/scope";
import { collegePeople, publicPeople } from "@/lib/directory";
import { Shortcuts } from "@/app/shortcuts";
import { ScopeLinks } from "@/components/site/scope-links";
import { Directory } from "@/components/site/directory";

// Rendered per request, from the live database.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "People", description: "Students with shipped, signed projects, ordered by credit earned. Members also see everyone at their college." };

export default async function People({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const me = await currentUser();
  const { view, college } = scopeFor(me, (await searchParams).scope);
  const own = me && college ? collegePeople(me, college) : [];
  const people = view === "college" ? own : publicPeople(own);
  return (
    <section className="sec light page-top">
      <ScopeLinks base="/people" view={view} member={!!college} />
      <h1 className="mega" data-reveal>People</h1>
      {me?.onboarded && !college && <p className="tool-note">{me.role === "alum" ? "Your alumni account is waiting for an admin of your community to approve it." : <span>The people in your community stay hidden until you <a href="/onboarding">prove your college or work email</a>.</span>}</p>}
      <p className="lead page-lead" data-reveal>
        {view === "college" && college
          ? `Everyone at ${college.name}, shipped or not, ordered by credit earned. Each person shows how you are connected through projects.`
          : "Students with at least one shipped project, ordered by credit earned. Credit is worked out from team, review and split records every time, so nobody can edit it."}
      </p>
      <Directory key={view} people={people} view={view} />
      <Shortcuts />
    </section>
  );
}
