import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { Motion } from "@/components/site/motion";
import { SiteToast } from "@/components/site/toast";
import { baseUrl, currentUser, demoMode } from "@/lib/auth";
import { setConsent } from "@/app/actions";
import { ConsentBanner } from "@/app/consent";
import { CONSENT_COOKIE, readConsent } from "@/lib/consent";
import { isMember } from "@/lib/college";
import { CallProvider } from "@/app/calls/ui";
import { BottomNav } from "@/app/bottom-nav";
import { UnreadBadge } from "@/app/unread-badge";
import { unreadMessages } from "@/lib/chat";
import { get } from "@/lib/db";
import { fonts } from "@/components/shell/fonts";
import { TopBar } from "@/components/shell/top-bar";
import { Foot } from "@/components/shell/foot";
import { SampleNote } from "@/components/shell/note";
import "@/components/shell/shell.css";
import "@/app/calls/calls.css";
import "./site.css";

/* Root layout of the public pages. Members' pages have their own (app/(app)/layout.tsx): the two stylesheets use many
   of the same class names, so they are never loaded together. The header and footer are the same on both. */
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

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  const signedIn = !!me?.onboarded;
  const member = signedIn && isMember(me);
  // The cookie notice shows on this device until it is closed.
  const consent = readConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  const dms = member ? unreadMessages(me.id) : 0;
  const unread = signedIn ? get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND seen=0", me.id)!.n : 0;
  return (
    <html lang="en-IN" className={fonts}>
      <body>
        <TopBar over />
        <main id="main" tabIndex={-1}>{children}</main>
        <SampleNote className="sample-note" />
        <Foot signedIn={!!me} />
        <Motion />
        <Suspense><SiteToast /></Suspense>
        {!consent && <ConsentBanner action={setConsent} />}
        {member && <CallProvider anon={!!me?.anon} />}
        {member && <BottomNav me={me.id} dms={dms} unread={unread} />}
        {signedIn && <UnreadBadge count={unread + dms} />}
      </body>
    </html>
  );
}
