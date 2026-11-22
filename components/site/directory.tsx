"use client";

import { useMemo, useState } from "react";
import type { Builder } from "@/lib/site";
import type { View } from "@/lib/scope";
import { BuilderList } from "./builder-list";

const PAGE = 30;

/* People, in either scope: search, sorting and filters over the ranked list. */
export function Directory({ people, view }: { people: Builder[]; view: View }) {
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [skill, setSkill] = useState("");
  const [college, setCollege] = useState("");
  const [sort, setSort] = useState("credit");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const branches = useMemo(() => [...new Set(people.map((p) => p.branch).filter(Boolean))].sort(), [people]);
  const colleges = useMemo(() => [...new Set(people.map((p) => p.college.name))].sort(), [people]);
  const skills = useMemo(() => {
    const n = new Map<string, number>();
    people.forEach((p) => p.skills?.forEach((s) => n.set(s, (n.get(s) ?? 0) + 1)));
    return [...n].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [people]);

  const words = q.trim().toLowerCase();
  const list = people.filter((p) => (!onlyOpen || p.open) && (!branch || p.branch === branch) && (!skill || p.skills?.includes(skill)) && (!college || p.college.name === college) &&
    (!words || [p.name, p.branch, p.college.name, ...(p.skills ?? [])].join(" ").toLowerCase().includes(words)));
  list.sort((a, b) => sort === "shipped" ? b.shipped - a.shipped || b.earned - a.earned : sort === "name" ? a.name.localeCompare(b.name) : b.earned - a.earned || b.shipped - a.shipped);
  const narrow = (set: (v: string) => void) => (v: string) => { set(v); setShown(PAGE); };

  return (
    <>
      <div className="tools">
        <input type="search" id="people-q" value={q} onChange={(e) => narrow(setQ)(e.target.value)} placeholder="Search a name, branch or skill (press /)" aria-label="Search people" />
        <select id="people-branch" value={branch} onChange={(e) => narrow(setBranch)(e.target.value)} aria-label="Branch">
          <option value="">All branches</option>{branches.map((s) => <option key={s}>{s}</option>)}
        </select>
        {skills.length > 0 && (
          <select id="people-skill" value={skill} onChange={(e) => narrow(setSkill)(e.target.value)} aria-label="Skill">
            <option value="">Any skill</option>{skills.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {colleges.length > 1 && (
          <select id="people-college" value={college} onChange={(e) => narrow(setCollege)(e.target.value)} aria-label="College">
            <option value="">Any college</option>{colleges.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <select id="people-sort" value={sort} onChange={(e) => narrow(setSort)(e.target.value)} aria-label="Sort">
          <option value="credit">Most credit</option><option value="shipped">Most shipped</option><option value="name">Name</option>
        </select>
      </div>
      <div className="pills">
        <button type="button" data-filter="open" aria-pressed={onlyOpen} onClick={() => { setOnlyOpen(!onlyOpen); setShown(PAGE); }}>Open to projects <span className="mono">{people.filter((p) => p.open).length}</span></button>
        {skills.slice(0, 10).map((s) => <button key={s} type="button" aria-pressed={skill === s} onClick={() => narrow(setSkill)(skill === s ? "" : s)}>{s}</button>)}
      </div>
      <p className="mono muted list-count" role="status">{list.length} {list.length === 1 ? "person" : "people"}</p>
      {list.length
        ? <BuilderList builders={list.slice(0, shown)} inside={view === "college"} />
        : <p className="lead">{people.length ? "No one matches. Clear a filter." : "No one has shipped yet."}</p>}
      {list.length > shown && <div className="sec-end"><button type="button" className="btn-line" data-more onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown}) <span aria-hidden="true">↓</span></button></div>}
    </>
  );
}
