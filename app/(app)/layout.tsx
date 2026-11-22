import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { BottomNav } from "@/app/bottom-nav";
import { Shortcuts } from "@/app/shortcuts";
import { Toast } from "@/app/client";
import { baseUrl, currentUser, demoMode } from "@/lib/auth";
import { setConsent } from "@/app/actions";
import { ConsentBanner } from "@/app/consent";
import { CONSENT_COOKIE, readConsent } from "@/lib/consent";
import { isMember } from "@/lib/college";
import { CallProvider } from "@/app/calls/ui";
import { UnreadBadge } from "@/app/unread-badge";
import { unreadMessages } from "@/lib/chat";
import { get } from "@/lib/db";
import { fonts } from "@/components/shell/fonts";
import { TopBar } from "@/components/shell/top-bar";
import { Foot } from "@/components/shell/foot";
import { SampleNote } from "@/components/shell/note";
import "@/components/shell/shell.css";
import "@/app/calls/calls.css";
import "@/app/globals.css";
import "./member.css";

/* Root layout of members' pages. Public pages have their own (app/(site)/layout.tsx), with the same header and footer. */
const about = "A network of colleges where students build projects together. Credit comes only from projects that ship, signed by teammates and outside reviewers.";
export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: { default: "Connect: credit only for what ships", template: "%s · Connect" },
  description: about,
  // Named here: a layout inside a route group doesn't inherit app/opengraph-image.tsx once it sets openGraph.
  openGraph: { title: "Connect", description: about, type: "website", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
  appleWebApp: { capable: true, title: "Connect", statusBarStyle: "black-translucent" },
  // The test copy stays out of search engines.
  ...(demoMode ? { robots: { index: false, follow: false } } : {}),
};
export const viewport: Viewport = { themeColor: "#0f0000", width: "device-width", initialScale: 1 };

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const signedIn = !!me?.onboarded;
  const member = signedIn && isMember(me);
  // The cookie notice shows on this device until it is closed.
  const consent = readConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  const dms = member ? unreadMessages(me.id) : 0;
  const unread = signedIn ? get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND seen=0", me.id)!.n : 0;
  return (
    <html lang="en-IN" className={fonts}>
      <body className={me ? undefined : "guest"}>
        <TopBar />
        <SampleNote className="member-note" />
        {signedIn && !member && (
          <div className="strip"><div className="wrap">
            {me.role === "alum" ? "Your alumni account is waiting for an admin of your community to approve it."
              : <>Your community&rsquo;s projects and people stay hidden until you <Link href="/onboarding">prove your college or work email</Link>.</>}
          </div></div>
        )}
        <main id="main" tabIndex={-1} className="wrap">{children}</main>
        <Foot signedIn={!!me} />
        <Suspense><Toast /></Suspense>
        {!consent && <ConsentBanner action={setConsent} />}
        {member && <CallProvider anon={!!me?.anon} />}
        {member && <BottomNav me={me.id} dms={dms} unread={unread} />}
        {member && <Shortcuts />}
        {signedIn && <UnreadBadge count={unread + dms} />}
      </body>
    </html>
  );
}
