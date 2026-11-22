import type { Metadata } from "next";
import { api } from "@/lib/site-data";
import Link from "next/link";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "How rating works", description: "How Connect works out credit, skills and credibility, rule by rule." };
// Rendered per request, from the live database.
export const dynamic = "force-dynamic";

/* Public: anyone deciding whether to trust a Connect profile can read exactly how the number is made. The text and every
   number in it come from the backend's own rules, so this page cannot drift from what the code does. */
export default async function RulesPage() {
  const me = await currentUser();
  const { sections } = await api.rules();
  return (
    <>
      <section className="sec dark page-top">
        <h1 className="mega">How rating works</h1>
        <p className="lead page-lead">Credit, skills and credibility, and exactly how each one is worked out. Nothing you type about yourself can raise any of them.</p>
        {!me && <div className="ac-cta"><Link className="btn-line mono-btn" href="/signin">Join your community on Connect →</Link></div>}
      </section>
      {sections.map((s, i) => (
        <section key={s.title} className={`sec ${i % 2 === 0 ? "light" : "dark"} split`}>
          <div className="ac-stack tight">
            <h2 className="title">{s.title}</h2>
            <p className="ac-intro">{s.intro}</p>
          </div>
          <ol className="ac-rules-list">
            {s.rules.map((r) => (
              <li key={r.title}>
                <div className="ac-rule"><h3>{r.title}</h3><p>{r.text}</p></div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
