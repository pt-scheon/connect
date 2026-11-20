"use client";
import Link from "next/link";
import { useState, useTransition } from "react";

type Act = (choice: string) => Promise<void>;

/* Shown once per device until the person answers. The two answers are equal buttons: neither is pushed. */
export function ConsentBanner({ action }: { action: Act }) {
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  if (gone) return null;
  const pick = (c: string) => start(async () => { await action(c); setGone(true); });
  return (
    <section className="consent" role="region" aria-label="Cookies and statistics">
      <p><b>Cookies and statistics.</b> Connect uses only the cookies it needs: to keep you signed in and remember your choices. No ads, no tracking.
        With your OK it also counts which days you open Connect, so admins can see usage charts. That is counts only, never which pages, and needs no cookie.{" "}
        <Link href="/cookies">Details</Link></p>
      <div className="row consent-btns">
        <button type="button" className="btn sm" disabled={pending} onClick={() => pick("all")}>Allow statistics</button>
        <button type="button" className="btn sm" disabled={pending} onClick={() => pick("necessary")}>Necessary only</button>
      </div>
    </section>
  );
}

/* The same choice on the Cookies page, where it can be changed at any time. */
export function ConsentChoice({ action, current }: { action: Act; current: "all" | "necessary" | null }) {
  const [now, setNow] = useState(current);
  const [pending, start] = useTransition();
  const pick = (c: "all" | "necessary") => start(async () => { await action(c); setNow(c); });
  return (
    <div className="stack tight">
      <div className="row" role="group" aria-label="Statistics">
        <button type="button" className={`btn sm ${now === "all" ? "" : "ghost"}`} aria-pressed={now === "all"} disabled={pending} onClick={() => pick("all")}>Allow statistics</button>
        <button type="button" className={`btn sm ${now === "necessary" ? "" : "ghost"}`} aria-pressed={now === "necessary"} disabled={pending} onClick={() => pick("necessary")}>Necessary only</button>
      </div>
      <span className="small muted" role="status">{now === "all" ? "Your visit days are counted in the statistics." : now === "necessary" ? "Your visits are not counted." : "You have not chosen yet. Until you do, signed-in visits are counted."}</span>
    </div>
  );
}
