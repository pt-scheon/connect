import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bricolage_Grotesque, Hanken_Grotesk, DM_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { get } from "@/lib/db";
import { baseUrl, currentUser, standings } from "@/lib/auth";
import { signOut } from "./actions";
import { NavLinks, ThemeToggle, Toast } from "./client";
import { Av } from "./ui";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

const about = "Build things with people from your college. Credit comes only from projects that ship, signed by your teammates.";
export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: { default: "Connect", template: "%s · Connect" },
  description: about,
  openGraph: { title: "Connect", description: about, type: "website" },
  appleWebApp: { capable: true, title: "Connect", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0A0B14" }, { media: "(prefers-color-scheme: light)", color: "#F2F3F8" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const signedIn = !!me?.onboarded;
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  const unread = signedIn ? get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND seen=0", me.id).n : 0;
  return (
    <html lang="en" data-theme={theme} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="bar">
          <div className="wrap">
            <Link href="/" className="logo"><i />Connect</Link>
            {signedIn ? (
              <>
                <nav className="tabs" aria-label="Sections">
                  <NavLinks admin={!!me.admin} />
                  <form action={signOut}><button>Sign out</button></form>
                </nav>
                <div className="right">
                  <ThemeToggle theme={theme} />
                  <Link href="/inbox" className="bell" aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}>
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
              <div className="right" style={{ marginLeft: "auto" }}><ThemeToggle theme={theme} />{!me && <Link className="btn sm" href="/signin">Sign in</Link>}</div>
            )}
          </div>
        </header>
        {signedIn && !me.verified && (
          <div className="strip"><div className="wrap">
            {me.role === "alum" ? "Your alumni account is waiting for an admin to approve it. You can look around until then."
              : <>You can look around, but you cannot join or post until you <Link href="/onboarding">verify your college email</Link>.</>}
          </div></div>
        )}
        <main className="wrap">{children}</main>
        <footer className="foot"><div className="wrap">
          <span>Connect. Credit comes only from what ships.</span>
          <span className="row"><Link href="/rules">How credit works</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>{signedIn ? <Link href="/settings">Settings</Link> : <Link href="/signin">Sign in</Link>}</span>
        </div></footer>
        <Suspense><Toast /></Suspense>
      </body>
    </html>
  );
}
