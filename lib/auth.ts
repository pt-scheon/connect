import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { get, run, now, type Row } from "./db";
import { compute } from "./credit";

const prod = process.env.NODE_ENV === "production";
/* Sample sign-in (pick any seeded person). Never available in production. */
export const devLogin = !prod && process.env.ALLOW_DEV_LOGIN !== "0";
export const baseUrl = () => process.env.APP_URL || "http://localhost:3000";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && prod) throw new Error("Set SESSION_SECRET before running in production.");
  return s || "dev-only-secret";
}
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("hex");

export async function setSession(userId: number) {
  (await cookies()).set("sid", `${userId}.${sign(String(userId))}`, {
    httpOnly: true, sameSite: "lax", secure: prod, path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
export async function clearSession() {
  (await cookies()).delete("sid");
}

export const currentUser = cache(async (): Promise<Row | null> => {
  const c = (await cookies()).get("sid")?.value;
  if (!c) return null;
  const [id, sig] = c.split(".");
  const want = sign(id);
  if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return get("SELECT * FROM users WHERE id=? AND suspended=0", Number(id)) ?? null;
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
    run("UPDATE users SET picture=COALESCE(?, picture), admin=MAX(admin, ?) WHERE id=?", p.picture ?? null, admin, id);
  } else {
    id = Number(run("INSERT INTO users (sub, name, email, email_verified, picture, admin, created_at) VALUES (?,?,?,?,?,?,?)",
      p.sub, p.name, email, p.emailVerified ? 1 : 0, p.picture ?? null, admin, now()).lastInsertRowid);
  }
  run("INSERT OR IGNORE INTO identities (sub, user_id) VALUES (?,?)", p.sub, id);
  return id;
}

/* A student whose sign-in email is already on the college domain needs no code. */
export function collegeDomain() {
  return (process.env.COLLEGE_EMAIL_DOMAIN || "").toLowerCase();
}
export function autoVerify(userId: number) {
  const u = get("SELECT * FROM users WHERE id=?", userId);
  const d = collegeDomain();
  if (!u || u.verified || u.role !== "student" || !d || !u.email_verified || !u.email?.endsWith("@" + d)) return false;
  if (get("SELECT 1 FROM users WHERE college_email=? AND id<>?", u.email, userId)) return false;
  run("UPDATE users SET verified=1, college_email=? WHERE id=?", u.email, userId);
  return true;
}
