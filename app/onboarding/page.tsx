import { redirect } from "next/navigation";
import Link from "next/link";
import { get, now } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { RULES } from "@/lib/credit";
import { mailReady } from "@/lib/mail";
import { saveProfile, sendCode, verifyCode } from "../actions";
import { F } from "../ui";

export const metadata = { title: "Your profile" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/signin");
  const editing = !me.onboarded || (await searchParams).edit;
  const pending = get("SELECT * FROM codes WHERE user_id=? AND expires>?", me.id, now());
  const domain = process.env.COLLEGE_EMAIL_DOMAIN;
  const prod = process.env.NODE_ENV === "production";
  const showCode = !prod && !mailReady();
  const noMail = prod && !mailReady();

  if (editing) return (
    <div className="card narrow">
      <h1>{me.onboarded ? "Edit your profile" : `Welcome, ${me.name.split(" ")[0]}`}</h1>
      <form action={saveProfile} className="stack">
        {!me.onboarded && (
          <label className="field"><span>I am a</span>
            <select name="role" id="role" defaultValue="student"><option value="student">Current student</option><option value="alum">Alum</option></select>
            <small>This cannot be changed later.</small></label>
        )}
        <label className="field"><span>Branch</span><input type="text" name="branch" id="branch" defaultValue={me.branch} placeholder="ECE, CSE, Mech…" required /></label>
        <label className="field"><span>Graduation year</span><input type="number" name="grad_year" id="grad_year" defaultValue={me.grad_year ?? ""} placeholder="2027" required /></label>
        <label className="field"><span>Skills</span><input type="text" name="skills" id="skills" defaultValue={me.skills} placeholder="React, ESP32, Figma" />
          <small>Comma separated. They show as “self-listed” until a shipped project backs them.</small></label>
        <label className="field"><span>One line about you</span><input type="text" name="about" id="about" defaultValue={me.about} placeholder="What you like building" /></label>
        <label className="field"><span>GitHub</span><input type="url" name="github" id="github" defaultValue={me.github ?? ""} placeholder="https://github.com/you" /></label>
        <label className="field"><span>LinkedIn</span><input type="url" name="linkedin" id="linkedin" defaultValue={me.linkedin ?? ""} placeholder="https://www.linkedin.com/in/you" /></label>
        <label className="field"><span>Portfolio or website</span><input type="url" name="website" id="website" defaultValue={me.website ?? ""} placeholder="https://" />
          <small>Optional. Shown on your profile and resume link.</small></label>
        <button className="btn">Save</button>
      </form>
    </div>
  );

  if (me.verified) redirect("/");
  if (me.role === "alum") return (
    <div className="card narrow">
      <h1>Waiting for approval</h1>
      <p className="muted">An admin checks each alum by hand before they can fund projects. You can look around in the meantime.</p>
      <Link className="btn" href="/">Look around</Link>
    </div>
  );
  return (
    <div className="card narrow">
      <h1>Verify your college email</h1>
      <p className="muted">This is what proves you study here. You get {RULES.starter} starter credit once it is done.</p>
      {domain && !noMail && <p className="small muted">Tip: if you sign in with your @{domain} Google account, this step is skipped.</p>}
      {noMail ? (
        <div className="note">
          {domain ? <>Sign out, then sign in with your <b>@{domain}</b> Google account. That proves you study here and verifies you straight away.</>
            : <>Email codes are not switched on for this site yet. An admin can verify you.</>}
        </div>
      ) : <>
      <F action={sendCode} back="/onboarding" className="row">
        <input type="email" name="email" id="email" placeholder={domain ? `you@${domain}` : "you@college.ac.in"} defaultValue={pending?.email ?? ""} required />
        <button className="btn ghost">{pending ? "Send again" : "Send code"}</button>
      </F>
      {pending && (
        <F action={verifyCode} back="/onboarding" className="row">
          <input type="text" name="code" id="code" inputMode="numeric" placeholder="6-digit code" required />
          <button className="btn">Verify</button>
        </F>
      )}
      </>}
      {pending && showCode && <div className="note">Development mode: no email service is set up, so the code is shown here: <b className="mono">{pending.code}</b></div>}
      <Link href="/" className="small">Skip for now</Link>
    </div>
  );
}
