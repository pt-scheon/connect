import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { get } from "@/lib/db";
import { collegeById, isMember } from "@/lib/college";
import { unreadMessages } from "@/lib/chat";
import { CallProvider } from "./calls/ui";
import { BottomNav } from "./bottom-nav";
import { baseUrl, currentUser, demoMode, standings } from "@/lib/auth";
import { signOut } from "./actions";
import { NavLinks, ThemeToggle, Toast } from "./client";
import { Av } from "./ui";
import "./globals.css";
import "./public.css";

/* Geist for text, Geist Mono for every number that measures something, on the public site and in the app. */
const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const measure = Geist_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-geist-mono" });

const about = "Build things with people from your college. Credit comes only from projects that ship, signed by your teammates.";
export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: { default: "Connect", template: "%s · Connect" },
  description: about,
  openGraph: { title: "Connect", description: about, type: "website" },
  appleWebApp: { capable: true, title: "Connect", statusBarStyle: "black-translucent" },
  // The test copy stays out of search engines.
  ...(demoMode ? { robots: { index: false, follow: false } } : {}),
};
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0B0A09" }, { media: "(prefers-color-scheme: light)", color: "#F7F5F2" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const signedIn = !!me?.onboarded;
  const member = signedIn && isMember(me);
  const college = member ? collegeById(me.college_id) : null;
  const dms = member ? unreadMessages(me.id) : 0;
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  const unread = signedIn ? get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND seen=0", me.id).n : 0;
  return (
    <html lang="en" data-theme={theme} className={`${sans.variable} ${measure.variable}`}>
      <body className={me ? undefined : "guest"}>
        <a className="skip" href="#main">Skip to content</a>
        <header className="bar">
          <div className="wrap">
            <Link href="/" className="logo"><i />Connect</Link>
            {college && <Link href={`/c/${college.slug}`} className="college-chip" title={college.name}>{college.name}</Link>}
            {signedIn ? (
              <>
                <nav className="tabs" aria-label="Sections">
                  {member ? <NavLinks admin={!!me.admin} /> : <span className="small muted">Finish verifying to see your college</span>}
                  <form action={signOut}><button>Sign out</button></form>
                </nav>
                <div className="right">
                  <ThemeToggle theme={theme} />
                  {member && (
                    <Link href="/messages" className="bell top-only" aria-label={dms ? `Messages, ${dms} unread` : "Messages"}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      {dms > 0 && <b>{dms > 9 ? "9+" : dms}</b>}
                    </Link>
                  )}
                  <Link href="/inbox" className="bell top-only" aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                    {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
                  </Link>
                  <Link href={`/u/${me.id}`} className="who" aria-label="Your profile">
                    {me.role === "student" && <span className="bal">{standings().get(me.id)?.credit ?? 0}<span className="hide-sm"> credit</span></span>}
                    <Av u={me} />
                  </Link>
                </div>
              </>
            ) : (
              <nav className="right guest-nav" aria-label="Site" style={{ marginLeft: "auto" }}>{me ? <ThemeToggle theme={theme} /> : <><Link href="/rules">How credit works</Link><Link href="/colleges">Colleges</Link><Link className="btn sm" href="/signin">Sign in</Link></>}</nav>
            )}
          </div>
        </header>
        {demoMode && <div className="strip"><div className="wrap">Test site with invented sample people. Nothing here is real. The real Connect is at <a href="https://connect-production-77ec4d79.up.railway.app">connect-production-77ec4d79.up.railway.app</a>.</div></div>}
        {signedIn && !member && (
          <div className="strip"><div className="wrap">
            {me.role === "alum" ? "Your alumni account is waiting for an admin of your college to approve it."
              : <>Your college&rsquo;s projects and people stay hidden until you <Link href="/onboarding">prove your college email</Link>.</>}
          </div></div>
        )}
        <main id="main" tabIndex={-1} className="wrap">{children}</main>
        <footer className="foot"><div className="wrap">
          <span>Connect. Credit comes only from what ships.</span>
          <span className="row"><Link href="/rules">How credit works</Link><Link href="/colleges">Colleges</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>{signedIn ? <Link href="/settings">Settings</Link> : <Link href="/signin">Sign in</Link>}</span>
        </div></footer>
        <Suspense><Toast /></Suspense>
        {member && <CallProvider />}
        {member && <BottomNav me={me.id} dms={dms} unread={unread} />}
      </body>
    </html>
  );
}
