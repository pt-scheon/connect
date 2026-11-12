"use server";

import crypto from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, get, run, db, now, type Row } from "@/lib/db";
import { compute, RULES } from "@/lib/credit";
import { requireUser, currentUser, setSession, clearSession, devLogin, autoVerify } from "@/lib/auth";
import { notify, logUpdate, allow } from "@/lib/notify";
import { resumeFacts, writeResume } from "@/lib/resume";

/* ---------- plumbing ---------- */
function safeBack(v: FormDataEntryValue | null) {
  const s = String(v || "/");
  if (!s.startsWith("/") || s.startsWith("//")) return "/";
  const u = new URL(s, "http://x");
  u.searchParams.delete("err");
  u.searchParams.delete("ok");
  return u.pathname + u.search;
}
function bounce(back: string, key: "err" | "ok", msg: string): never {
  redirect(back + (back.includes("?") ? "&" : "?") + key + "=" + encodeURIComponent(msg));
}
function done(back: string, msg?: string): never {
  revalidatePath("/", "layout");
  if (msg) bounce(back, "ok", msg);
  redirect(back);
}
async function ctx(fd: FormData, needVerified = true) {
  const me = await requireUser();
  const back = safeBack(fd.get("back"));
  if (!allow(`act:${me.id}`, 40, 60)) bounce(back, "err", "Slow down a little. Try again in a minute.");
  if (needVerified && !me.verified)
    bounce(back, "err", me.role === "alum" ? "An admin has to approve your alumni account first." : "Verify your college email first.");
  return {
    me, back,
    s: (k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max),
    n: (k: string) => Math.trunc(Number(fd.get(k))) || 0,
    fail: (msg: string): never => bounce(back, "err", msg),
  };
}
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
const project = (id: number): Row | undefined => get("SELECT * FROM projects WHERE id=?", id);
const member = (pid: number, uid: number): Row | undefined => get("SELECT * FROM members WHERE project_id=? AND user_id=?", pid, uid);
const isActive = (pid: number, uid: number) => member(pid, uid)?.status === "active";
const open = (p: Row) => p.status === "recruiting" || p.status === "building";

/* ---------- sign-in, onboarding, verification ---------- */
export async function devSignIn(fd: FormData) {
  if (!devLogin) redirect("/signin");
  const u = get("SELECT id FROM users WHERE id=?", Number(fd.get("id")));
  if (u) await setSession(u.id);
  redirect("/");
}
export async function signOut() {
  await clearSession();
  redirect("/signin");
}
export async function saveProfile(fd: FormData) {
  const me = await currentUser();
  if (!me) redirect("/signin");
  const s = (k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
  const year = Number(fd.get("grad_year"));
  if (!s("branch") || !(year > 1950 && year < 2100)) redirect("/onboarding?err=" + encodeURIComponent("Fill in your branch and graduation year."));
  // The student/alum choice is made once. Changing it later would dodge verification.
  const role = me.onboarded ? me.role : fd.get("role") === "alum" ? "alum" : "student";
  const back = me.onboarded ? "/onboarding?edit=1" : "/onboarding";
  const links: Record<string, string> = {};
  for (const [k, host] of [["github", "github.com"], ["linkedin", "linkedin.com"], ["website", ""]] as const) {
    const v = s(k, 200);
    if (v && !profileLink(v, host)) redirect(back + (back.includes("?") ? "&" : "?") + "err=" + encodeURIComponent(
      host ? `That ${k === "github" ? "GitHub" : "LinkedIn"} link does not look right. Paste the full https://${host}/... address.` : "The website link has to start with https://"));
    links[k] = v;
  }
  run("UPDATE users SET branch=?, grad_year=?, skills=?, about=?, role=?, github=?, linkedin=?, website=?, onboarded=1 WHERE id=?",
    s("branch", 60), year, s("skills"), s("about"), role, links.github, links.linkedin, links.website, me.id);
  // Alumni are always approved by hand, whatever their email says.
  if (!me.onboarded && role === "alum") run("UPDATE users SET verified=0, college_email=NULL WHERE id=?", me.id);
  const auto = !me.onboarded && autoVerify(me.id);
  revalidatePath("/", "layout");
  if (auto) redirect("/?ok=" + encodeURIComponent(`Your college email is verified. You start with ${RULES.starter} credit.`));
  redirect(me.onboarded ? `/u/${me.id}` : "/onboarding");
}
/* A link a person adds to their profile: https only, and on the right site when one is expected. */
function profileLink(v: string, host: string) {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return false;
    return !host || u.hostname === host || u.hostname.endsWith("." + host);
  } catch { return false; }
}
export async function sendCode(fd: FormData) {
  const { me, s, fail } = await ctx(fd, false);
  const email = s("email").toLowerCase();
  const domain = (process.env.COLLEGE_EMAIL_DOMAIN || "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("That does not look like an email address.");
  if (domain && !email.endsWith("@" + domain)) fail(`Use your @${domain} address.`);
  if (get("SELECT 1 FROM users WHERE college_email=? AND id<>?", email, me.id)) fail("That college email is already linked to another account.");
  if (!allow(`code:${me.id}`, 3, 600)) fail("Too many codes requested. Wait ten minutes.");
  const code = String(crypto.randomInt(100000, 1000000));
  run("INSERT OR REPLACE INTO codes (user_id, email, code, expires, tries) VALUES (?,?,?,?,0)", me.id, email, code, now() + 900);
  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: email, subject: "Your Connect code", text: `Your Connect verification code is ${code}. It expires in 15 minutes.` }),
    });
    if (!r.ok) fail("Could not send the email. Try again.");
  } else {
    console.log(`[connect] verification code for ${email}: ${code}`);
  }
  done("/onboarding", "Code sent. It expires in 15 minutes.");
}
export async function verifyCode(fd: FormData) {
  const { me, s, fail } = await ctx(fd, false);
  const c = get("SELECT * FROM codes WHERE user_id=?", me.id);
  if (!c || c.expires < now()) fail("That code has expired. Send a new one.");
  if (c.tries >= 5) fail("Too many wrong tries. Send a new code.");
  if (c.code !== s("code")) {
    run("UPDATE codes SET tries=tries+1 WHERE user_id=?", me.id);
    fail("Wrong code.");
  }
  run("UPDATE users SET verified=1, college_email=? WHERE id=?", c.email, me.id);
  run("DELETE FROM codes WHERE user_id=?", me.id);
  done("/", `Verified. You start with ${RULES.starter} credit.`);
}

/* ---------- projects ---------- */
export async function createProject(fd: FormData) {
  const { me, s, fail } = await ctx(fd);
  if (me.role !== "student") fail("Only students can start projects.");
  const name = s("name", 60), pitch = s("pitch"), ms = lines(s("milestones", 1000)), roles = lines(s("roles", 1000));
  if (!name || !pitch || !ms.length) fail("Give it a name, one line on what it does, and at least one milestone.");
  const id = db.transaction(() => {
    const pid = Number(run("INSERT INTO projects (name, pitch, status, lead_id, created_at) VALUES (?,?,?,?,?)",
      name, pitch, roles.length ? "recruiting" : "building", me.id, now()).lastInsertRowid);
    run("INSERT INTO members (project_id, user_id, role) VALUES (?,?,?)", pid, me.id, s("myrole", 60) || "Lead");
    for (const m of ms) run("INSERT INTO milestones (project_id, title) VALUES (?,?)", pid, m.slice(0, 120));
    for (const r of roles) {
      const [title, ...note] = r.split(" - ");
      run("INSERT INTO roles (project_id, title, note) VALUES (?,?,?)", pid, title.slice(0, 60), note.join(" - ").slice(0, 160));
    }
    logUpdate(pid, me.id, `${me.name} posted the project`);
    return pid;
  })();
  done(`/projects/${id}`, "Project posted.");
}
export async function editProject(fd: FormData) {
  const { me, back, s, n, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.lead_id !== me.id || !open(p)) fail("Only the lead can edit a project before it goes for review.");
  const name = s("name", 60), pitch = s("pitch");
  if (!name || !pitch) fail("Give it a name and one line on what it does.");
  run("UPDATE projects SET name=?, pitch=? WHERE id=?", name, pitch, p!.id);
  if (name !== p!.name) logUpdate(p!.id, me.id, `Renamed from ${p!.name}`);
  done(back, "Project updated.");
}
export async function inviteToRole(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const r = get("SELECT r.*, p.name, p.lead_id, p.status FROM roles r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.open=1", n("role"));
  if (!r || r.lead_id !== me.id) fail("Only the lead can invite people to an open role.");
  const to = get("SELECT id, name FROM users WHERE id=? AND role='student' AND verified=1 AND suspended=0", n("to"));
  if (!to || member(r.project_id, to.id)) fail("That person cannot be invited.");
  if (get("SELECT 1 FROM notifications WHERE user_id=? AND href=? AND text LIKE ?", to.id, `/projects/${r.project_id}`, `%invited you%${r.title}%`))
    fail(`${to.name.split(" ")[0]} has already been invited to this role.`);
  if (!allow(`invite:${me.id}`, 15, 3600)) fail("You have sent a lot of invites. Try again in an hour.");
  notify(to.id, `${me.name} invited you to apply for ${r.title} on ${r.name}`, `/projects/${r.project_id}`);
  done(back, `Invited ${to.name.split(" ")[0]}. They can ask to join from the project page.`);
}
export async function addRole(fd: FormData) {
  const { me, back, s, n, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.lead_id !== me.id || !open(p)) fail("Only the lead can add roles to an open project.");
  if (!s("title")) fail("Name the role.");
  run("INSERT INTO roles (project_id, title, note) VALUES (?,?,?)", p!.id, s("title", 60), s("note", 160));
  done(back);
}
export async function closeRole(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const r = get("SELECT r.*, p.lead_id FROM roles r JOIN projects p ON p.id=r.project_id WHERE r.id=?", n("role"));
  if (!r || r.lead_id !== me.id) fail("Only the lead can close a role.");
  db.transaction(() => {
    run("UPDATE roles SET open=0 WHERE id=?", r.id);
    run("DELETE FROM requests WHERE role_id=? AND status='pending'", r.id);
  })();
  done(back);
}
export async function requestJoin(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const r = get("SELECT * FROM roles WHERE id=? AND open=1", n("role"));
  const p = r && project(r.project_id);
  if (!p || !open(p)) fail("That role is no longer open.");
  if (me.role !== "student") fail("Only students can join projects.");
  if (member(p.id, me.id)) fail("You have already been on this project.");
  if (get("SELECT 1 FROM requests WHERE project_id=? AND user_id=?", p.id, me.id)) fail("You have already asked to join this project.");
  if ((compute().get(me.id)?.credit ?? 0) < RULES.stake) fail(`You need ${RULES.stake} free credit to stake. Finish what you have joined first.`);
  run("INSERT INTO requests (role_id, project_id, user_id) VALUES (?,?,?)", r.id, p.id, me.id);
  notify(p.lead_id, `${me.name} asked to join ${p.name} as ${r.title}`, `/projects/${p.id}`);
  done(back, `Request sent. ${RULES.stake} credit is held until the team answers.`);
}
export async function withdrawRequest(fd: FormData) {
  const { me, back, n } = await ctx(fd);
  run("DELETE FROM requests WHERE project_id=? AND user_id=? AND status='pending'", n("id"), me.id);
  done(back, "Request withdrawn. Your stake is back.");
}
export async function answerRequest(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const q = get("SELECT q.*, r.title FROM requests q JOIN roles r ON r.id=q.role_id WHERE q.id=? AND q.status='pending'", n("request"));
  const p = q && project(q.project_id);
  if (!p || p.lead_id !== me.id) fail("Only the lead can answer join requests.");
  if (s("answer") !== "accept") {
    run("UPDATE requests SET status='declined' WHERE id=?", q.id);
    notify(q.user_id, `${p.name} declined your request. Your stake is back.`, `/projects/${p.id}`);
    done(back, "Declined. Their stake is returned.");
  }
  db.transaction(() => {
    run("INSERT INTO members (project_id, user_id, role, stake) VALUES (?,?,?,?)", p.id, q.user_id, q.title, RULES.stake);
    run("UPDATE requests SET status='accepted' WHERE id=?", q.id);
    run("UPDATE roles SET open=0 WHERE id=?", q.role_id);
    run("DELETE FROM requests WHERE role_id=? AND status='pending'", q.role_id);
    if (!get("SELECT 1 FROM roles WHERE project_id=? AND open=1", p.id)) run("UPDATE projects SET status='building' WHERE id=? AND status='recruiting'", p.id);
    const who = get("SELECT name FROM users WHERE id=?", q.user_id);
    logUpdate(p.id, q.user_id, `${who.name} joined as ${q.title}`);
    notify(q.user_id, `You are on the ${p.name} team as ${q.title}`, `/projects/${p.id}`);
  })();
  done(back, "Added to the team.");
}
export async function addProof(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || !isActive(p.id, me.id) || !open(p)) fail("Only the team can add proof while the project is open.");
  const url = s("url", 400);
  if (!/^https?:\/\/\S+\.\S+/.test(url) || !s("label")) fail("Add a label and a full link starting with https://");
  run("INSERT INTO proofs (project_id, label, url) VALUES (?,?,?)", p!.id, s("label", 80), url);
  done(back);
}
export async function removeProof(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const pr = get("SELECT * FROM proofs WHERE id=?", n("proof"));
  const p = pr && project(pr.project_id);
  if (!p || !isActive(p.id, me.id) || !open(p)) fail("Proof can only be changed by the team before review.");
  run("DELETE FROM proofs WHERE id=?", pr.id);
  done(back);
}
export async function addMilestone(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.lead_id !== me.id || !open(p) || !s("title")) fail("Only the lead can add milestones to an open project.");
  run("INSERT INTO milestones (project_id, title) VALUES (?,?)", p!.id, s("title", 120));
  done(back);
}
export async function toggleMilestone(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const m = get("SELECT * FROM milestones WHERE id=?", n("milestone"));
  const p = m && project(m.project_id);
  if (!p || !isActive(p.id, me.id) || !open(p)) fail("Only the team can tick milestones while the project is open.");
  run("UPDATE milestones SET done=1-done WHERE id=?", m.id);
  if (!m.done) logUpdate(p.id, me.id, `Milestone done: ${m.title}`);
  done(back);
}
export async function saveContribution(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || !isActive(p.id, me.id) || p.status === "shipped" || p.status === "dropped") fail("You can only edit this while the project is open.");
  run("UPDATE members SET role=?, did=? WHERE project_id=? AND user_id=?", s("role", 60) || "Member", s("did", 200), p!.id, me.id);
  done(back, "Saved.");
}
export async function submitForReview(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.lead_id !== me.id || !open(p)) fail("Only the lead can send an open project for review.");
  if (!get("SELECT 1 FROM proofs WHERE project_id=?", p!.id)) fail("Add at least one proof link first.");
  if (get("SELECT 1 FROM milestones WHERE project_id=? AND done=0", p!.id)) fail("Tick off every milestone first.");
  if (get("SELECT 1 FROM members WHERE project_id=? AND status='active' AND did=''", p!.id)) fail("Every teammate has to write what they did first.");
  db.transaction(() => {
    run("DELETE FROM reviews WHERE project_id=?", p!.id);
    run("UPDATE projects SET status='review' WHERE id=?", p!.id);
    logUpdate(p!.id, me.id, "Sent for review");
    // Tell the people who can review it.
    const S = compute();
    const onIt = new Set(all("SELECT user_id FROM members WHERE project_id=?", p!.id).map((r) => r.user_id));
    for (const u of all("SELECT id, admin FROM users WHERE verified=1 AND suspended=0"))
      if (!onIt.has(u.id) && (u.admin || (S.get(u.id)?.credit ?? 0) >= RULES.reviewerMin))
        notify(u.id, `${p!.name} is ready for review`, `/projects/${p!.id}`);
  })();
  done(back, "Sent for review.");
}
export async function reviewProject(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"));
  const verdict = n("verdict");
  if (!p || p.status !== "review" || ![0, RULES.demo, RULES.live].includes(verdict)) fail("This project is not up for review.");
  if (member(p!.id, me.id)) fail("You cannot review a project you were on.");
  if (!me.admin && (compute().get(me.id)?.credit ?? 0) < RULES.reviewerMin) fail(`You need ${RULES.reviewerMin} credit to review.`);
  let msg = "Review recorded. One more is needed.";
  db.transaction(() => {
    run("INSERT OR REPLACE INTO reviews (project_id, reviewer_id, verdict) VALUES (?,?,?)", p!.id, me.id, verdict);
    const rs = all("SELECT r.verdict, u.admin FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.project_id=?", p!.id);
    if (rs.length < RULES.reviewsNeeded && !rs.some((r) => r.admin)) return;
    const pot = Math.min(...rs.map((r) => r.verdict)); // the stricter reviewer wins
    const team = all("SELECT user_id FROM members WHERE project_id=? AND status='active'", p!.id).map((r) => r.user_id as number);
    if (pot === 0) {
      run("DELETE FROM reviews WHERE project_id=?", p!.id);
      run("UPDATE projects SET status='building' WHERE id=?", p!.id);
      logUpdate(p!.id, null, "Reviewers sent it back as not ready");
      for (const id of team) notify(id, `${p!.name} was sent back by reviewers as not ready`, `/projects/${p!.id}`);
      msg = "Sent back to the team as not ready.";
    } else {
      run("UPDATE projects SET status='shipped', pot=?, shipped_at=? WHERE id=?", pot, now(), p!.id);
      run("UPDATE members SET stake=0 WHERE project_id=? AND status='active'", p!.id);
      run("UPDATE roles SET open=0 WHERE project_id=?", p!.id);
      run("DELETE FROM requests WHERE project_id=? AND status='pending'", p!.id);
      run("UPDATE users SET resume=NULL WHERE id IN (SELECT user_id FROM members WHERE project_id=?)", p!.id);
      logUpdate(p!.id, null, `Shipped with a pot of ${pot}`);
      for (const id of team) notify(id, `${p!.name} shipped with a pot of ${pot}. Split the credit between your teammates.`, `/projects/${p!.id}`);
      msg = `Shipped with a pot of ${pot}.`;
    }
  })();
  done(back, msg);
}
export async function allocate(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.status !== "shipped" || !isActive(p.id, me.id)) fail("Only the team of a shipped project can split it.");
  const others = all("SELECT user_id FROM members WHERE project_id=? AND status='active' AND user_id<>?", p!.id, me.id).map((r) => r.user_id as number);
  if (!others.length) fail("There is no one else on this project.");
  const pcts = others.map((id) => n(`pct_${id}`));
  if (pcts.some((x) => x < 0 || x > 100) || pcts.reduce((a, b) => a + b, 0) !== 100) fail("The split between your teammates has to add up to 100.");
  db.transaction(() => {
    run("DELETE FROM allocations WHERE project_id=? AND from_id=?", p!.id, me.id);
    others.forEach((id, i) => run("INSERT INTO allocations (project_id, from_id, to_id, pct) VALUES (?,?,?,?)", p!.id, me.id, id, pcts[i]));
  })();
  done(back, "Split saved.");
}
export async function voteGone(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id")), target = n("target");
  if (!p || !open(p) || !isActive(p.id, me.id) || !isActive(p.id, target) || target === me.id) fail("You can only mark an active teammate on an open project.");
  if (target === p!.lead_id) fail("The lead cannot be voted out. If the lead is gone, leave the project.");
  let msg = "Marked. They are removed once two thirds of the team agree.";
  db.transaction(() => {
    run("INSERT OR IGNORE INTO gone_votes (project_id, voter_id, target_id) VALUES (?,?,?)", p!.id, me.id, target);
    const voters = get("SELECT COUNT(*) n FROM members WHERE project_id=? AND status='active' AND user_id<>?", p!.id, target).n;
    const votes = get("SELECT COUNT(*) n FROM gone_votes WHERE project_id=? AND target_id=?", p!.id, target).n;
    if (votes >= Math.max(2, Math.ceil((voters * 2) / 3))) {
      run("UPDATE members SET status='left' WHERE project_id=? AND user_id=?", p!.id, target);
      run("DELETE FROM gone_votes WHERE project_id=? AND (target_id=? OR voter_id=?)", p!.id, target, target);
      notify(target, `Your team removed you from ${p!.name}. Your stake is lost.`, `/projects/${p!.id}`);
      msg = "Removed from the team. Their stake is lost.";
    }
  })();
  done(back, msg);
}
export async function leaveProject(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.status === "shipped" || p.status === "dropped" || !isActive(p.id, me.id)) fail("You are not on an open project here.");
  if (p!.lead_id === me.id) fail("You are the lead. Drop the project instead.");
  run("UPDATE members SET status='left' WHERE project_id=? AND user_id=?", p!.id, me.id);
  done(back, "You left. This shows on your profile.");
}
export async function dropProject(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || p.lead_id !== me.id || p.status === "shipped" || p.status === "dropped") fail("Only the lead can drop a project that has not shipped.");
  db.transaction(() => {
    run("UPDATE projects SET status='dropped' WHERE id=?", p!.id);
    run("UPDATE members SET stake=0 WHERE project_id=?", p!.id);
    run("UPDATE roles SET open=0 WHERE project_id=?", p!.id);
    run("DELETE FROM requests WHERE project_id=? AND status='pending'", p!.id);
    logUpdate(p!.id, me.id, "Dropped by the lead");
    for (const m of all("SELECT user_id FROM members WHERE project_id=? AND status='active' AND user_id<>?", p!.id, me.id))
      notify(m.user_id, `${p!.name} was dropped by its lead. Your stake is back.`, `/projects/${p!.id}`);
  })();
  done(back, "Project dropped. Teammates get their stakes back.");
}

/* ---------- people ---------- */
export async function vouch(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const to = n("to");
  const together = get(
    `SELECT 1 FROM members a JOIN members b ON a.project_id=b.project_id JOIN projects p ON p.id=a.project_id
     WHERE a.user_id=? AND b.user_id=? AND a.status='active' AND b.status='active' AND p.status='shipped'`, me.id, to);
  if (to === me.id || !together) fail("You can only vouch for someone you shipped a project with.");
  const r = run("INSERT OR IGNORE INTO vouches (from_id, to_id, created_at) VALUES (?,?,?)", me.id, to, now());
  if (r.changes) notify(to, `${me.name} vouched for you`, `/u/${to}`);
  done(back, "Vouched.");
}
export async function addClaim(fd: FormData) {
  const { me, back, s, fail } = await ctx(fd, false);
  if (!s("text")) fail("Write the line first.");
  if (get("SELECT COUNT(*) n FROM claims WHERE user_id=?", me.id).n >= 10) fail("Ten unbacked lines is the limit.");
  run("INSERT INTO claims (user_id, text) VALUES (?,?)", me.id, s("text", 140));
  done(back, "Added as “No proof”. It does not change your credit.");
}
export async function removeClaim(fd: FormData) {
  const { me, back, n } = await ctx(fd, false);
  run("DELETE FROM claims WHERE id=? AND user_id=?", n("claim"), me.id);
  done(back);
}
export async function aiResume(fd: FormData) {
  const { me, back, fail } = await ctx(fd);
  const r = await writeResume(resumeFacts(me.id));
  if (!r.text) fail(r.error || "Could not write the resume.");
  run("UPDATE users SET resume=? WHERE id=?", r.text, me.id);
  done(back, "Resume written from your signed projects.");
}
export async function clearResume(fd: FormData) {
  const { me, back } = await ctx(fd);
  run("UPDATE users SET resume=NULL WHERE id=?", me.id);
  done(back);
}

/* ---------- clubs ---------- */
export async function createClub(fd: FormData) {
  const { me, back, s, n, fail } = await ctx(fd);
  if (!me.admin) fail("Only an admin can register a club.");
  const lead = get("SELECT id FROM users WHERE id=? AND verified=1 AND role='student'", n("lead"));
  if (!s("name") || !lead) fail("Give the club a name and pick a verified student as lead.");
  db.transaction(() => {
    const id = run("INSERT INTO clubs (name, about, lead_id) VALUES (?,?,?)", s("name", 60), s("about"), lead.id).lastInsertRowid;
    run("INSERT INTO club_members (club_id, user_id, role, confirmed) VALUES (?,?,'Lead',1)", id, lead.id);
  })();
  done(back, "Club registered.");
}
export async function joinClub(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  if (!get("SELECT 1 FROM clubs WHERE id=?", n("club"))) fail("No such club.");
  const c = get("SELECT * FROM clubs WHERE id=?", n("club"));
  const r = run("INSERT OR IGNORE INTO club_members (club_id, user_id) VALUES (?,?)", c.id, me.id);
  if (r.changes) notify(c.lead_id, `${me.name} asked to join ${c.name}`, `/clubs/${c.id}`);
  done(back, "Asked to join. The club lead confirms members.");
}
export async function setClubMember(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const c = get("SELECT * FROM clubs WHERE id=?", n("club")), user = n("user");
  if (!c) fail("No such club.");
  const boss = c.lead_id === me.id || me.admin;
  if (s("do") === "remove") {
    if (!boss && user !== me.id) fail("Only the club lead can remove members.");
    if (user === c.lead_id) fail("The lead cannot be removed. An admin can change the lead.");
    run("DELETE FROM club_members WHERE club_id=? AND user_id=?", c.id, user);
    done(back);
  }
  if (!boss) fail("Only the club lead can confirm members.");
  const was = get("SELECT confirmed FROM club_members WHERE club_id=? AND user_id=?", c.id, user);
  run("UPDATE club_members SET confirmed=1, role=? WHERE club_id=? AND user_id=?", user === c.lead_id ? "Lead" : s("role", 40) || "Member", c.id, user);
  if (was && !was.confirmed) notify(user, `You are now a member of ${c.name}`, `/clubs/${c.id}`);
  done(back, "Saved.");
}

/* ---------- alumni funding ---------- */
export async function createCall(fd: FormData) {
  const { me, back, s, n, fail } = await ctx(fd);
  if (me.role !== "alum") fail("Only approved alumni can open a funding call.");
  if (!s("title") || n("amount") <= 0 || n("min_credit") < 0) fail("Add a title and an amount.");
  run("INSERT INTO calls (alum_id, title, about, amount, min_credit) VALUES (?,?,?,?,?)", me.id, s("title", 80), s("about"), n("amount"), n("min_credit"));
  done(back, "Call opened.");
}
export async function closeCall(fd: FormData) {
  const { me, back, n } = await ctx(fd);
  run("UPDATE calls SET open=0 WHERE id=? AND alum_id=?", n("call"), me.id);
  done(back);
}
export async function applyToCall(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const c = get("SELECT * FROM calls WHERE id=? AND open=1", n("call")), p = project(n("id"));
  if (!c || !p || p.lead_id !== me.id || p.status === "dropped") fail("Only the lead of a live project can apply to an open call.");
  const S = compute();
  const team = all("SELECT user_id FROM members WHERE project_id=? AND status='active'", p!.id).map((r) => r.user_id as number);
  const credit = team.reduce((a, id) => a + (S.get(id)?.credit ?? 0), 0);
  if (credit < c.min_credit) fail(`Your team has ${credit} credit. This call needs ${c.min_credit}.`);
  if (!team.some((id) => (S.get(id)?.shipped ?? 0) > 0)) fail("Someone on the team has to have shipped a project before.");
  const r = run("INSERT OR IGNORE INTO applications (call_id, project_id) VALUES (?,?)", c.id, p!.id);
  if (r.changes) notify(c.alum_id, `${p!.name} applied to ${c.title}`, "/funding");
  done(back, "Application sent.");
}
export async function answerApplication(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const a = get("SELECT a.*, c.alum_id, c.amount, c.title, p.lead_id, p.name FROM applications a JOIN calls c ON c.id=a.call_id JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.status='pending'", n("application"));
  if (!a || a.alum_id !== me.id) fail("Only the alum who opened the call can answer.");
  if (s("answer") !== "accept") {
    run("UPDATE applications SET status='declined' WHERE id=?", a.id);
    notify(a.lead_id, `${a.title} did not fund ${a.name} this time`, "/funding");
    done(back, "Declined.");
  }
  // One line per payment: "8000 | Working booking flow"
  const parts = lines(s("parts", 1000)).map((l) => {
    const [amt, ...t] = l.split("|");
    return { amount: Math.trunc(Number(amt.replace(/[^\d.]/g, ""))), title: t.join("|").trim().slice(0, 120) };
  });
  const total = parts.reduce((x, p) => x + p.amount, 0);
  if (!parts.length || parts.some((p) => !(p.amount > 0) || !p.title)) fail("Write each payment as: amount | what has to be done");
  if (total > a.amount) fail(`The payments add up to more than the call's ${a.amount}.`);
  db.transaction(() => {
    const gid = run("INSERT INTO grants (project_id, alum_id, amount) VALUES (?,?,?)", a.project_id, me.id, total).lastInsertRowid;
    for (const p of parts) run("INSERT INTO grant_parts (grant_id, title, amount) VALUES (?,?,?)", gid, p.title, p.amount);
    run("UPDATE applications SET status='accepted' WHERE id=?", a.id);
    logUpdate(a.project_id, me.id, `Funded by ${me.name}`);
    notify(a.lead_id, `${me.name} is funding ${a.name}`, `/projects/${a.project_id}`);
  })();
  done(back, "Funded. Mark each payment as paid after you send it.");
}
export async function markPaid(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const part = get("SELECT gp.id, gp.title, g.alum_id, g.project_id, p.lead_id FROM grant_parts gp JOIN grants g ON g.id=gp.grant_id JOIN projects p ON p.id=g.project_id WHERE gp.id=?", n("part"));
  if (!part || part.alum_id !== me.id) fail("Only the alum funding this can mark a payment.");
  run("UPDATE grant_parts SET paid=1 WHERE id=?", part.id);
  notify(part.lead_id, `${me.name} marked a payment as sent: ${part.title}`, `/projects/${part.project_id}`);
  done(back, "Marked as paid.");
}

/* ---------- admin ---------- */
export async function approveAlum(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  run("UPDATE users SET verified=1 WHERE id=? AND role='alum'", n("user"));
  notify(n("user"), "Your alumni account is approved. You can open funding calls now.", "/funding");
  done(back, "Approved.");
}
export async function setSuspended(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  if (n("user") === me.id) fail("You cannot suspend yourself.");
  run("UPDATE users SET suspended=? WHERE id=? AND admin=0", n("on") ? 1 : 0, n("user"));
  done(back, n("on") ? "Suspended. They are signed out and cannot sign in." : "Restored.");
}
export async function setHidden(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  run("UPDATE projects SET hidden=? WHERE id=?", n("on") ? 1 : 0, n("id"));
  done(back, n("on") ? "Hidden from everyone except its team and admins." : "Visible again.");
}
export async function closeReport(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  run("UPDATE reports SET open=0 WHERE id=?", n("report"));
  done(back);
}

/* ---------- updates, inbox, reports ---------- */
export async function postUpdate(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"));
  if (!p || !isActive(p.id, me.id) || p.status === "dropped") fail("Only the team can post updates.");
  if (!s("text")) fail("Write the update first.");
  logUpdate(p!.id, me.id, s("text", 280), "post");
  done(back);
}
export async function readInbox(fd: FormData) {
  const { me, back } = await ctx(fd, false);
  run("UPDATE notifications SET seen=1 WHERE user_id=?", me.id);
  done(back);
}
export async function report(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const kind = s("kind") === "project" ? "project" : "user";
  if (!s("reason")) fail("Say what is wrong.");
  if (!allow(`report:${me.id}`, 5, 3600)) fail("You have sent several reports. Give the admins time to look.");
  run("INSERT INTO reports (by_id, kind, target_id, reason, created_at) VALUES (?,?,?,?,?)", me.id, kind, n("target"), s("reason", 300), now());
  for (const a of all("SELECT id FROM users WHERE admin=1")) notify(a.id, `New report on a ${kind === "user" ? "person" : "project"}`, "/admin");
  done(back, "Reported. An admin will look at it.");
}

/* ---------- AI help for reviewers ---------- */
export async function summariseProof(projectId: number): Promise<{ text?: string; error?: string }> {
  const me = await currentUser();
  if (!me?.onboarded || !me.verified) return { error: "Sign in and verify first." };
  const p = project(projectId);
  if (!p || p.status !== "review") return { error: "This project is not up for review." };
  if (member(p.id, me.id)) return { error: "You cannot review a project you were on." };
  if (!me.admin && (compute().get(me.id)?.credit ?? 0) < RULES.reviewerMin) return { error: `You need ${RULES.reviewerMin} credit to review.` };
  if (!allow(`ai:${me.id}`, 10, 3600)) return { error: "You have asked for several summaries. Try again in an hour." };
  const { proofSummary } = await import("@/lib/review-help");
  return proofSummary(p.id);
}
