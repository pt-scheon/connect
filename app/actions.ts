"use server";

import crypto from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, get, run, db, now, type Row } from "@/lib/db";
import { compute, RULES } from "@/lib/credit";
import { requireUser, currentUser, setSession, clearSession, devLogin, autoVerify } from "@/lib/auth";
import { addCollege, collegeById, collegeForEmail, isMember } from "@/lib/college";
import { domainOf, isEmail, isPublicMail } from "@/lib/domains";
import { notify, logUpdate, allow } from "@/lib/notify";
import { resumeFacts, writeResume } from "@/lib/resume";
import { mailReady, sendMail } from "@/lib/mail";
import { remove as removeFile } from "@/lib/files";

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
  if (needVerified && !isMember(me))
    bounce(back, "err", me.role === "alum" ? "An admin of your college has to approve your alumni account first." : "Verify your college email first.");
  return {
    me, back,
    s: (k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max),
    n: (k: string) => Math.trunc(Number(fd.get(k))) || 0,
    fail: (msg: string): never => bounce(back, "err", msg),
  };
}
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
/* A project, only if it belongs to the person's own college. Every project action goes through this. */
const project = (id: number, me: Row): Row | undefined => get("SELECT * FROM projects WHERE id=? AND college_id=?", id, me.college_id);
/* Someone at the same college. */
const colleague = (id: number, me: Row, extra = ""): Row | undefined =>
  get(`SELECT * FROM users WHERE id=? AND college_id=? AND deleted=0 ${extra}`, id, me.college_id);
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
  // Alumni say which college they are from; an admin of that college approves them by hand.
  const alumCollege = !me.onboarded && role === "alum" ? get("SELECT * FROM colleges WHERE id=? AND status='active'", Number(fd.get("college"))) : null;
  if (!me.onboarded && role === "alum" && !alumCollege) redirect(back + "?err=" + encodeURIComponent("Pick the college you graduated from."));
  run("UPDATE users SET branch=?, grad_year=?, skills=?, about=?, role=?, github=?, linkedin=?, website=?, onboarded=1 WHERE id=?",
    s("branch", 60), year, s("skills"), s("about"), role, links.github, links.linkedin, links.website, me.id);
  if (alumCollege) {
    run("UPDATE users SET verified=0, college_email=NULL, college_id=? WHERE id=?", alumCollege.id, me.id);
    for (const a of all("SELECT id FROM users WHERE admin=1 AND college_id=?", alumCollege.id))
      notify(a.id, `${me.name} says they are an alum of ${alumCollege.name}. Approve them if that is true.`, "/admin");
  }
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
  if (me.role !== "student") fail("Alumni are approved by an admin of their college, not by email code.");
  if (me.verified && me.college_id) fail(`You are already verified at ${collegeById(me.college_id)?.name ?? "your college"}. A verified account stays with its college.`);
  const email = s("email").toLowerCase(), domain = domainOf(email);
  if (!isEmail(email)) fail("That does not look like an email address.");
  if (isPublicMail(domain)) fail("Use the email your college gave you, not a personal one like Gmail. That is what proves where you study.");
  if (get("SELECT 1 FROM users WHERE college_email=? AND id<>?", email, me.id)) fail("That college email is already linked to another account.");
  const known = collegeForEmail(email), name = s("college_name", 80);
  if (!known && name.length < 3) fail(`@${domain} is not on Connect yet. Add your college's full name and we will set it up.`);
  if (!allow(`code:${me.id}`, 3, 600)) fail("Too many codes requested. Wait ten minutes.");
  const code = String(crypto.randomInt(100000, 1000000));
  run("INSERT OR REPLACE INTO codes (user_id, email, code, expires, tries, college_name) VALUES (?,?,?,?,0,?)", me.id, email, code, now() + 900, known ? "" : name);
  if (mailReady()) {
    if (!(await sendMail(email, "Your Connect code", `Your Connect verification code is ${code}. It expires in 15 minutes.\n\nIf you did not ask for this, ignore this email.`)))
      fail("Could not send the email. Try again in a minute.");
  } else if (process.env.NODE_ENV === "production") {
    run("DELETE FROM codes WHERE user_id=?", me.id);
    fail("Email codes are not switched on yet. Sign out and sign in with your college Google account instead; that verifies you straight away. Or ask your college's admin below.");
  } else {
    console.log(`[connect] verification code for ${email}: ${code}`);
  }
  done("/onboarding", `Code sent to ${email}. It expires in 15 minutes.`);
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
  if (me.verified && me.college_id) fail("You are already verified.");
  if (get("SELECT 1 FROM users WHERE college_email=? AND id<>?", c.email, me.id)) fail("That college email is already linked to another account.");
  const college = db.transaction(() => {
    const col = collegeForEmail(c.email) ?? addCollege(c.college_name || domainOf(c.email), c.email, me.id);
    run("UPDATE users SET verified=1, college_email=?, college_id=? WHERE id=?", c.email, col.id, me.id);
    run("DELETE FROM codes WHERE user_id=?", me.id);
    return col;
  })();
  if (college.status !== "active") {
    for (const a of all("SELECT id FROM users WHERE super=1")) notify(a.id, `New college waiting for approval: ${college.name} (@${college.domains})`, "/admin/colleges");
    done("/onboarding", `Email confirmed. ${college.name} is new on Connect, so the team checks it first. You will get in as soon as it is approved.`);
  }
  done("/", `Verified at ${college.name}. You start with ${RULES.starter} credit.`);
}
/* The email Google or LinkedIn confirmed at sign-in is already proof. If it is on a college domain, the student can join
   that college with it (adding the college, with a name they give, if it is new on Connect). */
export async function joinWithSignInEmail(fd: FormData) {
  const { me, s, fail } = await ctx(fd, false);
  if (me.role !== "student") fail("Alumni are approved by an admin of their college.");
  if (me.verified && me.college_id) fail("You are already verified.");
  const email = String(me.email ?? "").toLowerCase(), domain = domainOf(email);
  if (!me.email_verified || !isEmail(email) || isPublicMail(domain)) fail("Your sign-in email is not a college email. Use a code instead.");
  if (get("SELECT 1 FROM users WHERE college_email=? AND id<>?", email, me.id)) fail("That college email is already linked to another account.");
  const name = s("college_name", 80);
  const known = collegeForEmail(email);
  if (!known && name.length < 3) fail("Add your college's full name.");
  const college = db.transaction(() => {
    const col = known ?? addCollege(name, email, me.id);
    run("UPDATE users SET verified=1, college_email=?, college_id=? WHERE id=?", email, col.id, me.id);
    return col;
  })();
  if (college.status !== "active") {
    for (const a of all("SELECT id FROM users WHERE super=1")) notify(a.id, `New college waiting for approval: ${college.name} (@${college.domains})`, "/admin/colleges");
    done("/onboarding", `Email confirmed. ${college.name} is new on Connect, so the team checks it first.`);
  }
  done("/", `Verified at ${college.name}. You start with ${RULES.starter} credit.`);
}

/* No email code available: the student names their college and waits for one of its admins to vouch for them. */
export async function askCollegeAdmin(fd: FormData) {
  const { me, n, fail } = await ctx(fd, false);
  if (me.role !== "student" || (me.verified && me.college_id)) fail("This is only for students who have not verified yet.");
  const c = get("SELECT * FROM colleges WHERE id=? AND status='active'", n("college"));
  if (!c) fail("Pick your college.");
  run("UPDATE users SET college_id=? WHERE id=? AND verified=0", c.id, me.id);
  for (const a of all("SELECT id FROM users WHERE admin=1 AND college_id=?", c.id))
    notify(a.id, `${me.name} asked to be verified as a student of ${c.name}`, "/admin");
  done("/onboarding", `Asked the admins of ${c.name}. You will get a note in your inbox once they verify you.`);
}

/* ---------- projects ---------- */
export async function createProject(fd: FormData) {
  const { me, s, fail } = await ctx(fd);
  if (me.role !== "student") fail("Only students can start projects.");
  const name = s("name", 60), pitch = s("pitch"), ms = lines(s("milestones", 1000)), roles = lines(s("roles", 1000));
  if (!name || !pitch || !ms.length) fail("Give it a name, one line on what it does, and at least one milestone.");
  const id = db.transaction(() => {
    const pid = Number(run("INSERT INTO projects (name, pitch, status, lead_id, college_id, created_at) VALUES (?,?,?,?,?,?)",
      name, pitch, roles.length ? "recruiting" : "building", me.id, me.college_id, now()).lastInsertRowid);
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
  const p = project(n("id"), me);
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
  const to = colleague(n("to"), me, "AND role='student' AND verified=1 AND suspended=0");
  if (!to || member(r.project_id, to.id)) fail("That person cannot be invited.");
  if (get("SELECT 1 FROM notifications WHERE user_id=? AND href=? AND text LIKE ?", to.id, `/projects/${r.project_id}`, `%invited you%${r.title}%`))
    fail(`${to.name.split(" ")[0]} has already been invited to this role.`);
  if (!allow(`invite:${me.id}`, 15, 3600)) fail("You have sent a lot of invites. Try again in an hour.");
  notify(to.id, `${me.name} invited you to apply for ${r.title} on ${r.name}`, `/projects/${r.project_id}`);
  if (!get("SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)", to.id, me.id, me.id, to.id))
    run("INSERT INTO messages (from_id, to_id, text, kind, project_id, created_at) VALUES (?,?,?,?,?,?)",
      me.id, to.id, `Invited you to join ${r.name} as ${r.title}.`, "invite", r.project_id, now());
  done(back, `Invited ${to.name.split(" ")[0]}. They can ask to join from the project page.`);
}
export async function addRole(fd: FormData) {
  const { me, back, s, n, fail } = await ctx(fd);
  const p = project(n("id"), me);
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
  const { me, back, n, s, fail } = await ctx(fd);
  const r = get("SELECT * FROM roles WHERE id=? AND open=1", n("role"));
  const p = r && project(r.project_id, me);
  if (!p || !open(p)) fail("That role is no longer open.");
  if (me.role !== "student") fail("Only students can join projects.");
  if (member(p.id, me.id)) fail("You have already been on this project.");
  if (get("SELECT 1 FROM requests WHERE project_id=? AND user_id=?", p.id, me.id)) fail("You have already asked to join this project.");
  if ((compute().get(me.id)?.credit ?? 0) < RULES.stake) fail(`You need ${RULES.stake} free credit to stake. Finish what you have joined first.`);
  const note = s("note", 400);
  run("INSERT INTO requests (role_id, project_id, user_id, note) VALUES (?,?,?,?)", r.id, p.id, me.id, note);
  notify(p.lead_id, `${me.name} asked to join ${p.name} as ${r.title}${note ? `: "${note.length > 80 ? note.slice(0, 77) + "..." : note}"` : ""}`, `/projects/${p.id}#requests`);
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
  const p = q && project(q.project_id, me);
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
  const p = project(n("id"), me);
  if (!p || !isActive(p.id, me.id) || !open(p)) fail("Only the team can add proof while the project is open.");
  const url = s("url", 400);
  if (!/^https?:\/\/\S+\.\S+/.test(url) || !s("label")) fail("Add a label and a full link starting with https://");
  run("INSERT INTO proofs (project_id, label, url) VALUES (?,?,?)", p!.id, s("label", 80), url);
  done(back);
}
export async function removeProof(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const pr = get("SELECT * FROM proofs WHERE id=?", n("proof"));
  const p = pr && project(pr.project_id, me);
  if (!p || !isActive(p.id, me.id) || !open(p)) fail("Proof can only be changed by the team before review.");
  run("DELETE FROM proofs WHERE id=?", pr.id);
  done(back);
}
export async function addMilestone(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"), me);
  if (!p || p.lead_id !== me.id || !open(p) || !s("title")) fail("Only the lead can add milestones to an open project.");
  run("INSERT INTO milestones (project_id, title) VALUES (?,?)", p!.id, s("title", 120));
  done(back);
}
export async function toggleMilestone(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const m = get("SELECT * FROM milestones WHERE id=?", n("milestone"));
  const p = m && project(m.project_id, me);
  if (!p || !isActive(p.id, me.id) || !open(p)) fail("Only the team can tick milestones while the project is open.");
  run("UPDATE milestones SET done=1-done WHERE id=?", m.id);
  if (!m.done) logUpdate(p.id, me.id, `Milestone done: ${m.title}`);
  done(back);
}
export async function saveContribution(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"), me);
  if (!p || !isActive(p.id, me.id) || p.status === "shipped" || p.status === "dropped") fail("You can only edit this while the project is open.");
  run("UPDATE members SET role=?, did=? WHERE project_id=? AND user_id=?", s("role", 60) || "Member", s("did", 200), p!.id, me.id);
  done(back, "Saved.");
}
export async function submitForReview(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"), me);
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
    for (const u of all("SELECT id, admin FROM users WHERE verified=1 AND suspended=0 AND college_id=?", me.college_id))
      if (!onIt.has(u.id) && (u.admin || (S.get(u.id)?.earned ?? 0) >= RULES.reviewerMin))
        notify(u.id, `${p!.name} is ready for review`, `/projects/${p!.id}`);
  })();
  done(back, "Sent for review.");
}
export async function reviewProject(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"), me);
  const verdict = n("verdict");
  const note = s("note", 400);
  if (verdict === 0 && note.length < 15) fail("Say what is missing, so the team knows what to fix. A sentence is enough.");
  if (!p || p.status !== "review" || ![0, RULES.demo, RULES.live].includes(verdict)) fail("This project is not up for review.");
  if (member(p!.id, me.id)) fail("You cannot review a project you were on.");
  if (!me.admin && (compute().get(me.id)?.earned ?? 0) < RULES.reviewerMin) fail(`You need ${RULES.reviewerMin} credit to review.`);
  let msg = "Review recorded. One more is needed.";
  db.transaction(() => {
    run("INSERT OR REPLACE INTO reviews (project_id, reviewer_id, verdict, note) VALUES (?,?,?,?)", p!.id, me.id, verdict, note);
    const rs = all("SELECT r.verdict, u.admin FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.project_id=?", p!.id);
    if (rs.length < RULES.reviewsNeeded && !rs.some((r) => r.admin)) return;
    const pot = Math.min(...rs.map((r) => r.verdict)); // the stricter reviewer wins
    // Keep each reviewer's verdict next to the outcome: this is how review accuracy is measured later.
    for (const r of all("SELECT reviewer_id, verdict FROM reviews WHERE project_id=?", p!.id))
      run("INSERT INTO review_log (project_id, reviewer_id, verdict, outcome, created_at) VALUES (?,?,?,?,?)", p!.id, r.reviewer_id, r.verdict, pot, now());
    const team = all("SELECT user_id FROM members WHERE project_id=? AND status='active'", p!.id).map((r) => r.user_id as number);
    // Reviewer notes go on the timeline without names, so reviewers can be candid.
    for (const r of all("SELECT note, verdict FROM reviews WHERE project_id=? AND note<>''", p!.id))
      logUpdate(p!.id, null, `Reviewer note (${r.verdict === 0 ? "not ready" : r.verdict === RULES.demo ? "demo only" : "live"}): ${r.note}`);
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
  const p = project(n("id"), me);
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
  const p = project(n("id"), me), target = n("target");
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
  const p = project(n("id"), me);
  if (!p || p.status === "shipped" || p.status === "dropped" || !isActive(p.id, me.id)) fail("You are not on an open project here.");
  if (p!.lead_id === me.id) fail("You are the lead. Drop the project instead.");
  run("UPDATE members SET status='left' WHERE project_id=? AND user_id=?", p!.id, me.id);
  done(back, "You left. This shows on your profile.");
}
export async function dropProject(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const p = project(n("id"), me);
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
  const lead = colleague(n("lead"), me, "AND verified=1 AND role='student'");
  if (!s("name") || !lead) fail("Give the club a name and pick a verified student as lead.");
  db.transaction(() => {
    const id = run("INSERT INTO clubs (name, about, lead_id, college_id) VALUES (?,?,?,?)", s("name", 60), s("about"), lead.id, me.college_id).lastInsertRowid;
    run("INSERT INTO club_members (club_id, user_id, role, confirmed) VALUES (?,?,'Lead',1)", id, lead.id);
  })();
  done(back, "Club registered.");
}
export async function joinClub(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const c = get("SELECT * FROM clubs WHERE id=? AND college_id=?", n("club"), me.college_id);
  if (!c) fail("No such club.");
  const r = run("INSERT OR IGNORE INTO club_members (club_id, user_id) VALUES (?,?)", c.id, me.id);
  if (r.changes) notify(c.lead_id, `${me.name} asked to join ${c.name}`, `/clubs/${c.id}`);
  done(back, "Asked to join. The club lead confirms members.");
}
export async function setClubMember(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const c = get("SELECT * FROM clubs WHERE id=? AND college_id=?", n("club"), me.college_id), user = n("user");
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
  run("INSERT INTO calls (alum_id, title, about, amount, min_credit, college_id) VALUES (?,?,?,?,?,?)", me.id, s("title", 80), s("about"), n("amount"), n("min_credit"), me.college_id);
  done(back, "Call opened.");
}
export async function closeCall(fd: FormData) {
  const { me, back, n } = await ctx(fd);
  run("UPDATE calls SET open=0 WHERE id=? AND alum_id=?", n("call"), me.id);
  done(back);
}
export async function applyToCall(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd);
  const c = get("SELECT * FROM calls WHERE id=? AND open=1 AND college_id=?", n("call"), me.college_id), p = project(n("id"), me);
  if (!c || !p || p.lead_id !== me.id || p.status === "dropped") fail("Only the lead of a live project can apply to an open call.");
  const S = compute();
  const team = all("SELECT user_id FROM members WHERE project_id=? AND status='active'", p!.id).map((r) => r.user_id as number);
  const credit = team.reduce((a, id) => a + (S.get(id)?.earned ?? 0), 0);
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
  if (!run("UPDATE users SET verified=1 WHERE id=? AND role='alum' AND college_id=?", n("user"), me.college_id).changes) fail("They are not waiting at your college.");
  notify(n("user"), "Your alumni account is approved. You can open funding calls now.", "/funding");
  done(back, "Approved.");
}
/* For colleges without email codes: an admin who knows the student verifies them by hand. */
export async function verifyStudent(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  if (!run("UPDATE users SET verified=1 WHERE id=? AND role='student' AND deleted=0 AND college_id=?", n("user"), me.college_id).changes) fail("They are not waiting at your college.");
  notify(n("user"), `An admin verified you as a student. You start with ${RULES.starter} credit and can join projects now.`, "/");
  done(back, "Verified.");
}
export async function setSuspended(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  if (n("user") === me.id) fail("You cannot suspend yourself.");
  if (!run("UPDATE users SET suspended=? WHERE id=? AND admin=0 AND (college_id=? OR ?)", n("on") ? 1 : 0, n("user"), me.college_id, me.super ? 1 : 0).changes) fail("You can only act on people at your college.");
  done(back, n("on") ? "Suspended. They are signed out and cannot sign in." : "Restored.");
}
export async function setHidden(fd: FormData) {
  const { me, back, n, fail } = await ctx(fd, false);
  if (!me.admin) fail("Admins only.");
  if (!run("UPDATE projects SET hidden=? WHERE id=? AND college_id=?", n("on") ? 1 : 0, n("id"), me.college_id).changes) fail("That project is not at your college.");
  done(back, n("on") ? "Hidden from everyone except its team and admins." : "Visible again.");
}
export async function closeReport(fd: FormData) {
  const c = await ctx(fd, false);
  const { me, back, n, fail } = c;
  if (!me.admin) fail("Admins only.");
  const { s } = c;
  // Upheld means the report was right. It lowers the reported person's credibility for a while.
  const result = s("result") === "upheld" ? "upheld" : "dismissed";
  run("UPDATE reports SET open=0, result=? WHERE id=? AND college_id=? AND open=1", result, n("report"), me.college_id);
  done(back, result === "upheld" ? "Report upheld." : "Report dismissed.");
}

/* ---------- updates, inbox, reports ---------- */
export async function postUpdate(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"), me);
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
  const where = get(`SELECT college_id FROM ${kind === "user" ? "users" : "projects"} WHERE id=?`, n("target"))?.college_id;
  if (!where) fail("Nothing to report there.");
  run("INSERT INTO reports (by_id, kind, target_id, reason, created_at, college_id) VALUES (?,?,?,?,?,?)", me.id, kind, n("target"), s("reason", 300), now(), where);
  for (const a of all("SELECT id FROM users WHERE admin=1 AND college_id=?", where)) notify(a.id, `New report on a ${kind === "user" ? "person" : "project"}`, "/admin");
  done(back, "Reported. An admin will look at it.");
}

/* ---------- questions on a project ---------- */
export async function postComment(fd: FormData) {
  const { me, back, n, s, fail } = await ctx(fd);
  const p = project(n("id"), me);
  if (!p || p.status === "dropped" || p.hidden) fail("You can't comment on this project.");
  const text = s("text", 500);
  if (text.length < 2) fail("Write something first.");
  if (!allow(`comment:${me.id}`, 10, 600)) fail("You are posting a lot. Wait a few minutes.");
  run("INSERT INTO comments (project_id, user_id, text, created_at) VALUES (?,?,?,?)", p!.id, me.id, text, now());
  const team = all("SELECT user_id FROM members WHERE project_id=? AND status='active'", p!.id).map((r) => r.user_id as number);
  const short = text.length > 60 ? text.slice(0, 57) + "..." : text;
  if (team.includes(me.id)) {
    // The team answered: tell the outsiders who asked.
    for (const r of all("SELECT DISTINCT user_id FROM comments WHERE project_id=? AND user_id<>?", p!.id, me.id))
      if (!team.includes(r.user_id)) notify(r.user_id, `${p!.name} replied: ${short}`, `/projects/${p!.id}#questions`);
  } else {
    for (const id of team) notify(id, `${me.name} asked about ${p!.name}: ${short}`, `/projects/${p!.id}#questions`);
  }
  done(back + "#questions");
}
export async function deleteComment(fd: FormData) {
  const { me, back, n } = await ctx(fd, false);
  const c = get("SELECT c.*, p.college_id FROM comments c JOIN projects p ON p.id=c.project_id WHERE c.id=?", n("comment"));
  if (c && (c.user_id === me.id || (me.admin && c.college_id === me.college_id))) run("DELETE FROM comments WHERE id=?", c.id);
  done(back + "#questions");
}

/* ---------- AI help for reviewers ---------- */
export async function summariseProof(projectId: number): Promise<{ text?: string; error?: string }> {
  const me = await currentUser();
  if (!me?.onboarded || !me.verified) return { error: "Sign in and verify first." };
  const p = project(projectId, me);
  if (!p || p.status !== "review") return { error: "This project is not up for review." };
  if (member(p.id, me.id)) return { error: "You cannot review a project you were on." };
  if (!me.admin && (compute().get(me.id)?.earned ?? 0) < RULES.reviewerMin) return { error: `You need ${RULES.reviewerMin} credit to review.` };
  if (!allow(`ai:${me.id}`, 10, 3600)) return { error: "You have asked for several summaries. Try again in an hour." };
  const { proofSummary } = await import("@/lib/review-help");
  return proofSummary(p.id);
}

/* ---------- settings and your data ---------- */
export async function saveSettings(fd: FormData) {
  const { me, back } = await ctx(fd, false);
  run("UPDATE users SET email_notes=?, open_to_join=? WHERE id=?", fd.get("email_notes") ? 1 : 0, fd.get("open_to_join") ? 1 : 0, me.id);
  done(back, "Settings saved.");
}
export async function toggleOpen(fd: FormData) {
  const { me, back } = await ctx(fd, false);
  run("UPDATE users SET open_to_join=1-open_to_join WHERE id=?", me.id);
  done(back, me.open_to_join ? "You are no longer marked as open to projects." : "Project leads can now see you are open to join.");
}
/* Deleting an account removes everything about the person. Their place in past teams stays, shown as
   "Deleted user", and so do vouches they gave, because teammates' signed history and credit depend on them. */
export async function deleteAccount(fd: FormData) {
  const { me, s, fail } = await ctx(fd, false);
  if (s("confirm").toLowerCase() !== "delete") fail('Type "delete" to confirm.');
  if (me.super && get("SELECT COUNT(*) n FROM users WHERE super=1 AND deleted=0").n <= 1) fail("You are the only site admin. Add another one first.");
  db.transaction(() => {
    run(`UPDATE users SET name='Deleted user', email=NULL, college_email=NULL, picture=NULL, about='', skills='', resume=NULL,
         github='', linkedin='', website='', sub=?, admin=0, super=0, email_notes=0, open_to_join=0, deleted=1, suspended=1 WHERE id=?`, `deleted:${me.id}:${crypto.randomUUID()}`, me.id);
    for (const q of ["DELETE FROM identities WHERE user_id=?", "DELETE FROM codes WHERE user_id=?", "DELETE FROM notifications WHERE user_id=?",
      "DELETE FROM claims WHERE user_id=?", "DELETE FROM club_members WHERE user_id=?", "DELETE FROM comments WHERE user_id=?",
      "DELETE FROM requests WHERE user_id=? AND status='pending'", "DELETE FROM blocks WHERE user_id=? OR blocked_id=?", "DELETE FROM push_subs WHERE user_id=?"]) run(q, ...(q.includes("OR") ? [me.id, me.id] : [me.id]));
    // Their conversations go too, attachments included.
    for (const f of all("SELECT file_key FROM messages WHERE (from_id=? OR to_id=?) AND file_key IS NOT NULL", me.id, me.id)) removeFile(f.file_key);
    run("DELETE FROM messages WHERE from_id=? OR to_id=?", me.id, me.id);
  })();
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/?ok=" + encodeURIComponent("Your account is deleted."));
}

/* ---------- site admins (ADMIN_EMAILS): colleges and who runs each one ---------- */
async function superCtx(fd: FormData) {
  const c = await ctx(fd, false);
  if (!c.me.super) c.fail("Site admins only.");
  return c;
}
export async function saveCollege(fd: FormData) {
  const { back, s, n, fail } = await superCtx(fd);
  const c = collegeById(n("id"));
  if (!c) fail("No such college.");
  const name = s("name", 80);
  const domains = s("domains", 300).toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (name.length < 3 || !domains.length || domains.some((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || isPublicMail(d)))
    fail("Give a name and at least one college email domain, like nirmauni.ac.in. Personal mail domains are not allowed.");
  for (const d of domains) {
    const other = get("SELECT name FROM colleges WHERE id<>? AND (',' || domains || ',') LIKE ?", c.id, `%,${d},%`);
    if (other) fail(`${d} already belongs to ${other.name}.`);
  }
  const status = ["active", "pending", "closed"].includes(s("status")) ? s("status") : c.status;
  run("UPDATE colleges SET name=?, domains=?, status=? WHERE id=?", name, domains.join(","), status, c.id);
  if (status === "active" && c.status !== "active")
    for (const u of all("SELECT id FROM users WHERE college_id=? AND verified=1", c.id))
      notify(u.id, `${name} is open on Connect. Welcome in.`, "/");
  done(back, "College saved.");
}
export async function setCollegeAdmin(fd: FormData) {
  const { back, n, s, fail } = await superCtx(fd);
  const u = get("SELECT * FROM users WHERE id=? AND college_id=? AND verified=1 AND deleted=0", n("user"), n("college"));
  if (!u) fail("Pick a verified person at that college.");
  const on = s("on") === "1";
  run("UPDATE users SET admin=? WHERE id=?", on ? 1 : 0, u.id);
  if (on) notify(u.id, "You are now an admin of your college on Connect.", "/admin");
  done(back, on ? `${u.name} is now an admin.` : `${u.name} is no longer an admin.`);
}
