"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { hideFromFeed } from "@/app/feed-actions";
import { statusLabel } from "@/app/bits";
import type { WorkItem } from "@/lib/site";
import { year } from "@/lib/site";
import type { View } from "@/lib/scope";
import { Avatar } from "./avatar";
import { Cover } from "./cover";

const PAGE = 24;

function matches(p: WorkItem, k: string) {
  const b = p.board;
  if (k === "all") return !b || b.status !== "dropped" || b.mine;
  if (k === "live" || k === "demo") return p.verdict === k;
  if (!b) return false;
  if (k === "fit") return b.fit.length > 0 && !b.mine;
  if (k === "open") return b.open.length > 0;
  if (k === "mine") return b.mine;
  if (k === "following") return b.followed && !b.mine;
  if (k === "review") return b.status === "review" && !b.mine;
  return b.status === k;
}

/* Work, in either scope: search, filters, sorting, and for your own college everything its board knows. */
export function WorkBoard({ items, view, forYou = [], canReview = false, initial }: {
  items: WorkItem[]; view: View; forYou?: { id: number; why: string[] }[]; canReview?: boolean; initial?: string;
}) {
  const filters = useMemo(() => {
    const any = (k: string) => items.some((p) => matches(p, k));
    const out: [string, string][] = [];
    if (view === "college") {
      if (forYou.length) out.push(["foryou", "For you"]);
      out.push(["all", "All"]);
      if (items.some((p) => p.board?.fit.length)) out.push(["fit", "Fits you"]);
      out.push(["open", "Needs people"], ["building", "Building"], ["shipped", "Shipped"], ["mine", "Mine"]);
    } else {
      out.push(["all", "All"]);
      if (any("mine")) out.push(["mine", "Mine"]);
    }
    if (any("following")) out.push(["following", "Following"]);
    if (view === "college" && canReview) out.push(["review", "To review"]);
    out.push(["live", "Live and in use"], ["demo", "Working demo"]);
    return out;
  }, [items, view, forYou.length, canReview]);

  const [f, setF] = useState(() => (initial && filters.some(([k]) => k === initial) ? initial : filters[0][0]));
  const [q, setQ] = useState("");
  const [skill, setSkill] = useState("");
  const [college, setCollege] = useState("");
  const [sort, setSort] = useState("default");
  const [shown, setShown] = useState(PAGE);
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<number | null>(null);
  const [, start] = useTransition();

  const why = useMemo(() => new Map(forYou.map((r) => [r.id, r.why])), [forYou]);
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);
  const skills = useMemo(() => [...new Set(items.flatMap((p) => p.skills))].sort(), [items]);
  const colleges = useMemo(() => [...new Set(items.map((p) => p.college.name))].sort(), [items]);
  const pool = (k: string) => k === "foryou"
    ? forYou.map((r) => byId.get(r.id)).filter((p): p is WorkItem => !!p && !gone.has(p.id))
    : items.filter((p) => matches(p, k));

  const words = q.trim().toLowerCase();
  const list = pool(f).filter((p) => (!skill || p.skills.includes(skill)) && (!college || p.college.name === college) &&
    (!words || [p.name, p.pitch, p.college.name, ...p.skills, ...(p.board?.open ?? []), ...(p.board?.team.map((u) => u.name) ?? [])].join(" ").toLowerCase().includes(words)));
  if (sort === "newest") list.sort((a, b) => b.at - a.at);
  if (sort === "credit") list.sort((a, b) => b.pot - a.pot || b.at - a.at);
  if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));

  const narrow = (set: (v: string) => void) => (v: string) => { set(v); setShown(PAGE); };
  const hide = (id: number, on: boolean) => {
    const put = (yes: boolean) => setGone((g) => { const n = new Set(g); if (yes) n.add(id); else n.delete(id); return n; });
    put(on);
    start(async () => { if (!(await hideFromFeed(id, on))) put(!on); });
  };

  return (
    <>
      <div className="tools">
        <input type="search" id="work-q" value={q} onChange={(e) => narrow(setQ)(e.target.value)} placeholder="Search projects, roles or skills (press /)" aria-label="Search work" />
        {skills.length > 0 && (
          <select id="work-skill" value={skill} onChange={(e) => narrow(setSkill)(e.target.value)} aria-label="Skill">
            <option value="">Any skill</option>{skills.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {colleges.length > 1 && (
          <select id="work-college" value={college} onChange={(e) => narrow(setCollege)(e.target.value)} aria-label="College">
            <option value="">Any college</option>{colleges.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <select id="work-sort" value={sort} onChange={(e) => narrow(setSort)(e.target.value)} aria-label="Sort">
          <option value="default">{f === "foryou" ? "Best for you" : "Latest first"}</option>
          {f === "foryou" && <option value="newest">Newest</option>}
          <option value="credit">Most credit</option><option value="name">Name</option>
        </select>
      </div>
      <div className="pills">
        {filters.map(([k, label]) => (
          <button key={k} type="button" data-filter={k} aria-pressed={f === k} onClick={() => narrow(setF)(k)}>{label} <span className="mono">{pool(k).length}</span></button>
        ))}
      </div>
      {f === "foryou" && undo !== null && byId.get(undo) && (
        <p className="tool-note" role="status">
          <span>{byId.get(undo)!.name} is out of For you. Projects like it will show up less.</span>
          <button type="button" onClick={() => { hide(undo, false); setUndo(null); }}>Undo</button>
        </p>
      )}
      <p className="mono muted list-count" role="status">{list.length} {list.length === 1 ? "project" : "projects"}</p>
      {list.length === 0 && (
        <p className="lead">{f === "foryou" ? "Nothing new for you right now. See All for every project." : items.length ? "Nothing matches. Try another filter." : view === "college" ? "No projects yet. Post the first one." : "Nothing has shipped yet."}</p>
      )}
      <div className="work-list">
        {list.slice(0, shown).map((p, i) => (
          <Row key={p.id} p={p} index={i} view={view} why={f === "foryou" ? why.get(p.id) ?? [] : null} onHide={() => { hide(p.id, true); setUndo(p.id); }} />
        ))}
      </div>
      {list.length > shown && <div className="sec-end"><button type="button" className="btn-line" data-more onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown}) <span aria-hidden="true">↓</span></button></div>}
    </>
  );
}

function Row({ p, index, view, why, onHide }: { p: WorkItem; index: number; view: View; why: string[] | null; onHide: () => void }) {
  const b = p.board;
  const body = (
    <>
      <div className="work-caption">
        <h3>{p.name}</h3>
        <p>{[p.skills.slice(0, 2).join(", "), p.shippedAt ? year(p.shippedAt) : ""].filter(Boolean).join(", ")}</p>
        {b && <span className="tags">
          <span className="tag">{statusLabel(b.status)}</span>
          {b.hidden === 2 && <span className="tag">Private</span>}
          {b.hidden === 1 && <span className="tag">Hidden</span>}
          {b.funded && <span className="tag hot">Alumni funded</span>}
        </span>}
        <p className="work-pitch">{p.pitch}</p>
        <span className="mono work-meta">{p.college.name}{p.verdict && ` · ${p.verdict === "live" ? "Live and in use" : "Working demo"}`}{p.pot > 0 && ` · ${p.pot} credit`}</span>
      </div>
      <div className="warp"><Cover id={p.id} name={p.name} image={p.image} /></div>
    </>
  );
  return (
    <article className={`work-item${b ? " is-board" : ""}`} data-reveal style={{ ["--d" as string]: `${Math.min(index, 3) * 80}ms` }}>
      {/* The board opens the project inside the college, which is in the other root layout: a full page load. */}
      {view === "college"
        ? <a href={`/projects/${p.id}`} className="work-link">{body}</a>
        : <Link href={`/work/${p.id}`} className="work-link">{body}</Link>}
      {b && (
        <div className="work-more"><div>
          <div className="work-facts mono">
            <span className="faces">{b.team.slice(0, 7).map((u) => <span key={u.id} title={u.name}><Avatar name={u.name} src={u.picture} /></span>)}</span>
            {b.team.length > 7 && <span>+{b.team.length - 7}</span>}
            <span className="work-meter" aria-hidden="true"><i style={{ width: `${b.total ? (100 * b.done) / b.total : 0}%` }} /></span>
            <span>{b.done}/{b.total} milestones</span>
            {b.active && <span className={b.quiet ? "work-quiet" : undefined}>{b.quiet ? "Quiet · " : "Active "}{b.active}</span>}
          </div>
          {b.open.length > 0 && <span className="tags">
            {b.open.map((r, i) => <span key={`${r}${i}`} className="tag">Needs: {r}</span>)}
            {b.fit.length > 0 && !b.mine && <span className="tag hot">Fits your {b.fit.slice(0, 2).join(", ")}</span>}
          </span>}
          {why && <div className="work-why">
            <span>{why.join(" · ") || "On your community board"}</span>
            <button type="button" onClick={onHide} aria-label={`Not for me: ${p.name}`}>Not for me</button>
          </div>}
          {view === "all" && <a className="work-inside mono" href={`/projects/${p.id}`}>Open inside your college →</a>}
        </div></div>
      )}
    </article>
  );
}
