"use client";

import Link from "next/link";
import { useState } from "react";
import type { Builder } from "@/lib/site";
import { Avatar } from "./avatar";
import { TierBadge, TierChip } from "./tier";
import { Name } from "@/components/site/name";

/* People as a list with a preview panel that follows the row you hover or focus, like an article index.
   `inside`: the viewer's own college, where a row opens the full profile (the other root layout, so a plain link). */
export function BuilderList({ builders, inside = false }: { builders: Builder[]; inside?: boolean }) {
  const [active, setActive] = useState(0);
  if (!builders.length) return <p className="muted">No one has shipped yet.</p>;
  const b = builders[Math.min(active, builders.length - 1)];
  return (
    <div className="index">
      <aside className="index-preview" aria-hidden="true">
        <div key={b.id} className="preview-card">
          <div className="preview-top">
            <Avatar name={b.name} src={b.avatar} className="preview-avatar" />
            <span className={`preview-tier tier-${b.tier.id}`}><TierBadge tier={b.tier} size={44} /><span className="mono">{b.tier.name}</span></span>
          </div>
          <dl className="preview-stats">
            <div><dt className="mono">Credit earned</dt><dd>{b.earned}</dd></div>
            <div><dt className="mono">Shipped</dt><dd>{b.shipped}<small>/{b.joined}</small></dd></div>
          </dl>
          <span className="mono preview-foot">{b.college.name}</span>
        </div>
      </aside>
      <ol className="index-rows">
        {builders.map((x, i) => {
          const Tag = inside ? "a" : Link;
          return (
          <li key={x.id} data-reveal style={{ ["--d" as string]: `${Math.min(i, 5) * 60}ms` }}>
            <Tag href={inside ? `/u/${x.id}` : `/people/${x.id}`} className="index-row" onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}>
              <span className="mono index-date">{x.classOf ? `Class of ${x.classOf}` : ""}</span>
              <span className="index-main">
                <span className="index-title"><Name name={x.name} />{x.anonymous && <span className="mono anon-tag">anonymous</span>}{x.inside?.you && <span className="mono anon-tag">you</span>}</span>
                <span className="index-sub">{[x.branch, x.college.name].filter(Boolean).join(" · ")}. Shipped {x.shipped} of {x.joined} joined.{!!x.inside?.left && <span className="index-left"> Left {x.inside.left}.</span>}</span>
                {(x.open || !!x.skills?.length) && <span className="tags">
                  {x.open && <span className="tag hot">Open to projects</span>}
                  {x.skills?.slice(0, 8).map((k) => <span key={k} className="tag">{k}</span>)}
                  {(x.skills?.length ?? 0) > 8 && <span className="tag">+{x.skills!.length - 8}</span>}
                </span>}
                {x.inside?.path && <span className="index-path">{x.inside.path}</span>}
              </span>
              <span className="index-meta">
                <span className="mono index-credit"><TierChip tier={x.tier} />{x.earned} credit</span>
                <span className="mono">{inside ? "Profile" : "Record"} →</span>
              </span>
            </Tag>
          </li>
          );
        })}
      </ol>
    </div>
  );
}
