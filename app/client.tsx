"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

type Action = (fd: FormData) => Promise<void>;

/* ---------- navigation ---------- */
/* ---------- toast: shows the result of the last action, passed back as ?ok= or ?err= ---------- */
export function Toast() {
  const q = useSearchParams(), path = usePathname(), router = useRouter();
  const err = q.get("err"), ok = q.get("ok");
  const [shown, setShown] = useState<{ msg: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const msg = err || ok;
    if (!msg) return;
    setShown({ msg, bad: !!err });
    const rest = new URLSearchParams(q.toString());
    rest.delete("ok");
    rest.delete("err");
    router.replace(path + (rest.size ? `?${rest}` : ""), { scroll: false });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), err ? 8000 : 4500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [err, ok]);
  if (!shown) return null;
  return (
    <div className={`toast ${shown.bad ? "err" : "ok"}`} role="status">
      <span>{shown.msg}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setShown(null)}>×</button>
    </div>
  );
}

/* ---------- a form that posts to a server action, shows it is working, and can ask "are you sure" ---------- */
export function F({ action, back, hidden, children, className, confirm }: {
  action: Action; back: string; hidden?: Record<string, string | number>; children: ReactNode; className?: string; confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  return (
    <form
      className={className}
      data-pending={pending || undefined}
      aria-busy={pending}
      action={(fd) => { setArmed(false); start(async () => { await action(fd); }); }}
      onSubmit={(e) => { if (confirm && !armed) { e.preventDefault(); setArmed(true); } }}
    >
      <input type="hidden" name="back" value={back} />
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      {armed ? (
        <span className="row confirm">
          <span className="small">{confirm}</span>
          <button className="btn danger sm">Yes, do it</button>
          <button type="button" className="btn ghost sm" onClick={() => setArmed(false)}>Cancel</button>
        </span>
      ) : children}
    </form>
  );
}

/* ---------- a number that counts up when it appears ---------- */
export function Count({ to }: { to: number }) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || to === 0) return setN(to);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n.toLocaleString("en-IN")}</>;
}

export function CopyLink({ path, label = "Copy profile link" }: { path: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm" onClick={async () => {
      try { await navigator.clipboard.writeText(window.location.origin + path); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : label}</button>
  );
}

/* ---------- ask to join: a button that opens a short pitch for the lead ---------- */
export function JoinAsk({ action, back, role, stake, title }: { action: Action; back: string; role: number; stake: number; title: string }) {
  const [openForm, setOpen] = useState(false);
  if (!openForm) return <button type="button" className="btn" onClick={() => setOpen(true)}>Ask to join · stake {stake}</button>;
  return (
    <F action={action} back={back} hidden={{ role }} className="stack join-ask">
      <label className="field"><span>Why you, for {title}?</span>
        <textarea name="note" id={`join-note-${role}`} rows={3} maxLength={400} autoFocus
          placeholder="What you would do, and something you built that shows it. A link helps." />
        <small>Optional, but leads say yes far more often when they can see what you have done.</small></label>
      <span className="row">
        <button className="btn">Send request · stake {stake}</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </span>
    </F>
  );
}

/* ---------- people: instant search, branch and skill filters, sorting ---------- */
/* ---------- credit split: sliders that have to add up to 100 ---------- */
export function SplitForm({ action, back, id, mates, saved }: {
  action: Action; back: string; id: number; mates: { id: number; name: string; did: string; pct: number }[]; saved: boolean;
}) {
  const [v, setV] = useState<Record<number, number>>(() => Object.fromEntries(mates.map((m) => [m.id, m.pct])));
  const total = Object.values(v).reduce((a, b) => a + b, 0);
  const set = (mid: number, n: number) => {
    const x = Math.max(0, Math.min(100, Math.round(n) || 0));
    // With two teammates the other one is whatever is left.
    if (mates.length === 2) setV({ [mid]: x, [mates.find((m) => m.id !== mid)!.id]: 100 - x });
    else setV({ ...v, [mid]: x });
  };
  const even = () => {
    const base = Math.floor(100 / mates.length);
    setV(Object.fromEntries(mates.map((m, i) => [m.id, base + (i < 100 - base * mates.length ? 1 : 0)])));
  };
  return (
    <F action={action} back={back} hidden={{ id }} className="card">
      <h2>Split the credit between your teammates</h2>
      <p className="small muted">Give out 100 between the others, by how much each one actually did. You are not on your own list, and they are doing the same for you.</p>
      {mates.map((m) => (
        <div key={m.id} className="split">
          <label htmlFor={`pct_${m.id}`} className="stack" style={{ gap: 0 }}><b>{m.name}</b><span className="small muted">{m.did}</span></label>
          <input type="range" min={0} max={100} step={1} value={v[m.id]} onChange={(e) => set(m.id, +e.target.value)} aria-label={`Share for ${m.name}`} disabled={mates.length === 1} />
          <input type="number" name={`pct_${m.id}`} id={`pct_${m.id}`} min={0} max={100} value={v[m.id]} onChange={(e) => set(m.id, +e.target.value)} readOnly={mates.length === 1} />
        </div>
      ))}
      <div className="row between">
        <span className={`mono ${total === 100 ? "" : "neg"}`}>Total {total} / 100{total !== 100 && ` · ${total < 100 ? `${100 - total} left to give` : `${total - 100} too many`}`}</span>
        <span className="row">
          {mates.length > 1 && <button type="button" className="btn ghost sm" onClick={even}>Split evenly</button>}
          <button className="btn" disabled={total !== 100}>{saved ? "Update split" : "Save split"}</button>
        </span>
      </div>
    </F>
  );
}

/* ---------- landing page: try to game the credit ---------- */

