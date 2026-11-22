import { NextResponse, type NextRequest } from "next/server";
import { AFTER_COOKIE } from "./lib/after";

/* Someone signed out who opens a members' page is sent to sign in by the page itself. This only notes which page it
   was, so signing in can bring them back to it (lib/after.ts). Next 16's name for middleware. */
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const opening = req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");
  // Work and People are public: only their "Your college" view needs signing in.
  const open = /^\/(work|people)(\/|$)/.test(req.nextUrl.pathname) && req.nextUrl.searchParams.get("scope") !== "college";
  if (opening && !open && !req.cookies.get("sid")?.value)
    res.cookies.set(AFTER_COOKIE, req.nextUrl.pathname + req.nextUrl.search, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return res;
}

export const config = {
  matcher: ["/work/:path*", "/people/:path*", "/clubs/:path*", "/funding/:path*", "/commissions/:path*", "/projects/:path*", "/credit/:path*", "/admin/:path*", "/inbox/:path*", "/messages/:path*", "/settings/:path*", "/feedback/:path*", "/share/:path*"],
};
