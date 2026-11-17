import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { get, run, now, type Row } from "./db";
import { compute } from "./credit";
import { competency } from "./skills";
import { collegeForEmail, isMember } from "./college";

const prod = process.env.NODE_ENV === "production";
export const baseUrl = () => process.env.APP_URL || "http://localhost:3000";
/* A cloud test copy of Connect, filled with invented sample people. Needs DEMO_MODE=1 and an address that says so
   (staging, demo or localhost), so it can never switch on for the real site by a stray setting. */
export function demoAllowed(flag: string | undefined, appUrl: string): boolean {
  if (flag !== "1") return false;
  try { return /(^|[.-])(staging|demo)([.-])|(^|\.)localhost$/.test(new URL(appUrl).hostname); } catch { return false; }
}
export const demoMode = demoAllowed(process.env.DEMO_MODE, baseUrl());
/* Sample sign-in (pick any seeded person). Only in development, or on a demo copy. */
export const devLogin = demoMode || (!prod && process.env.ALLOW_DEV_LOGIN !== "0");

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && prod) throw new Error("Set SESSION_SECRET before running in production.");
  return s || "dev-only-secret";
}
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("hex");
/* The cookie is "<id>.<signature>". The signature also covers the person's session counter once it is above zero,
   so "sign out everywhere" (which raises the counter) makes every older cookie stop working, while cookies made
   before the counter existed keep working. */
export const sessionToken = (userId: number, v = 0) => `${userId}.${sign(v ? `${userId}:${v}` : String(userId))}`;
export function tokenOk(token: string, userId: number, v = 0): boolean {
  const sig = token.split(".")[1], want = sessionToken(userId, v).split(".")[1];
  return !!sig && sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

export async function setSession(userId: number) {
  const v = get("SELECT session_v FROM users WHERE id=?", userId)?.session_v ?? 0;
  (await cookies()).set("sid", sessionToken(userId, v), {
    httpOnly: true, sameSite: "lax", secure: prod, path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
export async function clearSession() {
  (await cookies()).delete("sid");
}

export const currentUser = cache(async (): Promise<Row | null> => {
  const c = (await cookies()).get("sid")?.value;
  if (!c) return null;
  const id = Number(c.split(".")[0]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const u = get("SELECT * FROM users WHERE id=? AND suspended=0", id);
  return u && tokenOk(c, id, u.session_v ?? 0) ? u : null;
});

/* Signed in and finished onboarding, or sent to the right page. */
export async function requireUser(): Promise<Row> {
  const u = await currentUser();
  if (!u) redirect("/signin");
  if (!u.onboarded) redirect("/onboarding");
  return u;
}

/* One standings calculation per page render. */
export const standings = cache(() => compute());
/* And one skills calculation, built on those standings. */
export const skillScores = cache(() => competency(standings()));

/* Find or create the person a sign-in provider says just signed in.
   The same person signing in with Google and LinkedIn lands on one account when both report the same verified email. */
export function upsertUser(p: { sub: string; name: string; email?: string; emailVerified?: boolean; picture?: string }): number {
  const email = p.email?.toLowerCase() ?? null;
  const admins = (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  const admin = email && p.emailVerified && admins.includes(email) ? 1 : 0;
  let id: number | undefined =
    get("SELECT user_id FROM identities WHERE sub=?", p.sub)?.user_id ?? get("SELECT id FROM users WHERE sub=?", p.sub)?.id;
  if (!id && email && p.emailVerified) id = get("SELECT id FROM users WHERE email=? AND email_verified=1", email)?.id;
  if (id) {
    run("UPDATE users SET picture=COALESCE(?, picture), admin=MAX(admin, ?), super=MAX(super, ?) WHERE id=?", p.picture ?? null, admin, admin, id);
  } else {
    id = Number(run("INSERT INTO users (sub, name, email, email_verified, picture, admin, super, created_at) VALUES (?,?,?,?,?,?,?,?)",
      p.sub, p.name, email, p.emailVerified ? 1 : 0, p.picture ?? null, admin, admin, now()).lastInsertRowid);
  }
  run("INSERT OR IGNORE INTO identities (sub, user_id) VALUES (?,?)", p.sub, id);
  return id;
}

/* A student who signed in with a verified email on a college's domain needs no code: that email is the proof.
   Only that college can be joined this way, and someone already verified at a college never moves. */
export function autoVerify(userId: number) {
  const u = get("SELECT * FROM users WHERE id=?", userId);
  if (!u || u.verified || u.role !== "student" || !u.email_verified || !u.email) return false;
  const c = collegeForEmail(u.email);
  if (!c || get("SELECT 1 FROM users WHERE college_email=? AND id<>?", u.email, userId)) return false;
  run("UPDATE users SET verified=1, college_email=?, college_id=? WHERE id=?", u.email.toLowerCase(), c.id, userId);
  return c.status === "active";
}

/* Signed in, onboarded, and a verified member of an open college. Everything college-specific needs this. */
export async function requireMember(): Promise<Row> {
  const u = await requireUser();
  if (!isMember(u)) redirect("/onboarding");
  return u;
}
