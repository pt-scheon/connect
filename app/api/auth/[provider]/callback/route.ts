import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { get } from "@/lib/db";
import { autoVerify, baseUrl, setSession, upsertUser } from "@/lib/auth";
import { PROVIDERS, callbackUrl, ready } from "@/lib/oauth";

/* Step 2: the provider sends the person back with a code. Swap it for their name, email and photo. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const fail = (msg: string) => NextResponse.redirect(new URL("/signin?err=" + encodeURIComponent(msg), baseUrl()));
  const p = PROVIDERS[(await params).provider];
  if (!p || !ready(p)) return fail("That sign-in is not set up yet.");
  const q = req.nextUrl.searchParams;
  const jar = await cookies();
  const state = jar.get("oauth_state")?.value;
  jar.delete("oauth_state");
  if (q.get("error")) return fail(`${p.label} sign-in was cancelled.`);
  if (!q.get("code") || !state || state !== `${p.key}:${q.get("state")}`) return fail("Sign-in expired. Try again.");

  const token = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: q.get("code")!,
      client_id: p.clientId!,
      client_secret: p.clientSecret!,
      redirect_uri: callbackUrl(baseUrl(), p),
    }),
  });
  if (!token.ok) return fail(`${p.label} did not accept the sign-in.`);
  const { access_token } = await token.json();

  const info = await fetch(p.userinfoUrl, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!info.ok) return fail(`Could not read your ${p.label} profile.`);
  const who = await info.json();
  if (!who.sub || !who.name) return fail(`${p.label} did not share a name.`);

  const id = upsertUser({
    sub: `${p.key}:${who.sub}`, name: who.name, email: who.email, picture: who.picture,
    emailVerified: who.email_verified === true || who.email_verified === "true",
  });
  if (get("SELECT suspended FROM users WHERE id=?", id)?.suspended) return fail("This account has been suspended by an admin.");
  autoVerify(id);
  await setSession(id);
  return NextResponse.redirect(new URL("/", baseUrl()));
}
