"use client";

/* eslint-disable @next/next/no-img-element */
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isPublicPage } from "@/lib/routes";
import { Go } from "./go";

export type TopUser = {
  id: number; name: string; picture: string | null; onboarded: boolean; member: boolean; admin: boolean;
  college: { slug: string; name: string } | null; credit: number | null; inbox: number; messages: number;
};

const LINKS: [href: string, label: string][] = [
  ["/work", "work"], ["/colleges", "colleges"], ["/people", "people"],
  ["/clubs", "clubs"], ["/commissions", "commissions"], ["/funding", "funding"],
];
const badge = (n: number) => (n > 9 ? "9+" : n);

export function TopNav({ over, me, counts, signOut }: { over: boolean; me: TopUser | null; counts: { work: number; colleges: number }; signOut: () => Promise<void> }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(false);
  const box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => { setMenu(false); setPanel(false); }, [path]);
  useEffect(() => {
    document.documentElement.classList.toggle("sh-top-locked", menu);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      if (panel) { setPanel(false); btn.current?.focus(); }
    };
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setPanel(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.documentElement.classList.remove("sh-top-locked");
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [menu, panel]);

  // Rendering the open menu rewrites the class list, so have the scroll effect (components/site/motion) set its own again.
  useEffect(() => { window.dispatchEvent(new Event("scroll")); }, [menu]);

  // Public and members' pages have separate layouts, so crossing over reloads and would hang up a call: open a tab instead.
  useEffect(() => {
    const keepCall = (e: MouseEvent) => {
      if (!document.querySelector(".call-screen, .tc, .tc-mini")) return;
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.origin !== location.origin || isPublicPage(a.pathname) === isPublicPage(location.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(a.href, "_blank", "noopener");
    };
    document.addEventListener("click", keepCall, true);
    return () => document.removeEventListener("click", keepCall, true);
  }, []);

  const on = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/work" && path.startsWith("/projects/")) || (href === "/people" && path.startsWith("/u/") && path !== `/u/${me?.id}`);
  const initials = me?.name.split(/\s+/).filter((w) => !w.startsWith("(")).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const face = !me
    ? <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="8.5" r="3.75" /><path d="M4.75 19.5c1.2-3.4 3.9-5.25 7.25-5.25s6.05 1.85 7.25 5.25" strokeLinecap="round" /></svg>
    : me.picture ? <img src={me.picture} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>;
  const item = (href: string, label: string, n = 0) => (
    <Go signedIn={!!me} key={href} href={href} onClick={() => setPanel(false)}>{label}{n > 0 ? <b className="sh-top-count">{badge(n)}</b> : <span aria-hidden="true">→</span>}</Go>
  );
  const n: Record<string, number> = { "/work": counts.work, "/colleges": counts.colleges };

  return (
    <header className={`sh-top ${over ? "sh-top-over" : "sh-top-flow"}${menu ? " is-open" : ""}`} data-header>
      <a className="sh-top-skip" href="#main">Skip to content</a>
      <Go signedIn={!!me} href="/" className="sh-top-mark" aria-label="Connect, home">connect<span aria-hidden="true" /></Go>
      <div className="sh-top-right">
        <nav id="sh-top-nav" className="sh-top-nav" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <Go signedIn={!!me} key={href} href={href} className="sh-top-link" aria-current={on(href) ? "page" : undefined} onClick={() => setMenu(false)}>
              {label}{n[href] !== undefined && <sup>({n[href]})</sup>}
            </Go>
          ))}
          {me?.onboarded && <Go signedIn href="/credit" className="sh-top-link sh-top-extra" aria-current={on("/credit") ? "page" : undefined} onClick={() => setMenu(false)}>credit</Go>}
          {me?.admin && <Go signedIn href="/admin" className="sh-top-link sh-top-extra" aria-current={on("/admin") ? "page" : undefined} onClick={() => setMenu(false)}>admin</Go>}
        </nav>
        {!me ? <Go signedIn={!!me} href="/signin" className="sh-top-link sh-top-cta">join</Go>
          : !me.onboarded ? <Go signedIn={!!me} href="/onboarding" className="sh-top-link sh-top-cta">set up</Go>
          : <>
            {me.member && (
              <Go signedIn={!!me} href="/messages" className="sh-top-icon sh-top-only-wide" aria-label={me.messages ? `Messages, ${me.messages} unread` : "Messages"}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                {me.messages > 0 && <b className="sh-top-count">{badge(me.messages)}</b>}
              </Go>
            )}
            <Go signedIn={!!me} href="/inbox" className="sh-top-icon sh-top-only-wide" aria-label={me.inbox ? `Inbox, ${me.inbox} unread` : "Inbox"}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
              {me.inbox > 0 && <b className="sh-top-count">{badge(me.inbox)}</b>}
            </Go>
          </>}
        <div className="sh-top-account" ref={box}>
          <button ref={btn} type="button" className={`sh-top-face${me ? " has-user" : ""}`} aria-expanded={panel} aria-controls={id} onClick={() => setPanel((v) => !v)}
            aria-label={me ? `Account: ${me.name}${me.inbox + me.messages ? `, ${me.inbox + me.messages} unread` : ""}` : "Account and sign in"}>{face}</button>
          {me && me.inbox + me.messages > 0 && <i className="sh-top-pip" aria-hidden="true" />}
          <div id={id} className="sh-top-panel" hidden={!panel}>
            {me ? <>
              <p className="sh-top-who"><b>{me.name}</b><span>{me.college?.name ?? (me.onboarded ? "Not verified yet" : "Finish setting up")}{me.credit !== null && ` · ${me.credit} credit`}</span></p>
              <nav aria-label="Account">
                {me.onboarded ? <>
                  {item(`/u/${me.id}`, "Your profile")}
                  {item("/credit", "Credit")}
                  {item(`/u/${me.id}?tab=progress`, "Rank and progress")}
                  {me.member && item("/messages", "Messages", me.messages)}
                  {item("/inbox", "Inbox", me.inbox)}
                  {item("/settings", "Settings")}
                  {!me.member && item("/onboarding", "Verify your email")}
                  {me.member && item("/settings#alerts", "Alerts on this device")}
                  {item("/onboarding?edit=1", "Edit your profile")}
                  {me.college && item(`/colleges/${me.college.slug}`, "Your college's public page")}
                  {me.admin && item("/admin", "Admin")}
                </> : item("/onboarding", "Finish setting up")}
                {item(`/feedback?from=${encodeURIComponent(path)}`, "Send feedback")}
                {item("/rules", "How credit works")}
              </nav>
              <form action={signOut}><button type="submit" className="sh-top-out">Sign out</button></form>
            </> : <>
              <p className="sh-top-who"><span>You’re not signed in.</span></p>
              <nav aria-label="Account">{item("/signin", "Sign in to Connect")}{item("/rules", "How credit works")}</nav>
            </>}
          </div>
        </div>
        <button type="button" className="sh-top-burger" aria-expanded={menu} aria-controls="sh-top-nav" aria-label={menu ? "Close menu" : "Open menu"} onClick={() => setMenu((v) => !v)}><span aria-hidden="true" /></button>
      </div>
    </header>
  );
}
