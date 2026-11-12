import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { mailReady } from "@/lib/mail";
import { pushPublicKey } from "@/lib/push";
import { PushToggle } from "../push-toggle";
import { deleteAccount, saveSettings } from "../actions";
import { F } from "../ui";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const me = await requireUser();
  const to = me.college_email || me.email;
  return (
    <div className="narrow stack">
      <div className="head"><div className="stack tight">
        <h1>Settings</h1>
        <p>Alerts, how others can find you, and your data. To change your branch, skills or links, <Link href="/onboarding?edit=1">edit your profile</Link>.</p>
      </div></div>

      <F action={saveSettings} back="/settings" className="card stack">
        <span className="label">Alerts and visibility</span>
        <PushToggle publicKey={pushPublicKey()} />
        <label className="check">
          <input type="checkbox" name="email_notes" id="email_notes" defaultChecked={!!me.email_notes} />
          <span><b>Email me what lands in my inbox</b><br />
            <small className="muted">{!mailReady() ? "Email is not switched on for this site yet. Your inbox still works."
              : to ? `Sent to ${to}. At most six an hour.` : "We have no email address for you."}</small></span>
        </label>
        {me.role === "student" && (
          <label className="check">
            <input type="checkbox" name="open_to_join" id="open_to_join" defaultChecked={!!me.open_to_join} />
            <span><b>I am open to joining a project</b><br />
              <small className="muted">Shows an “Open to projects” badge on your profile and puts you in the People filter that project leads use.</small></span>
          </label>
        )}
        <div><button className="btn">Save</button></div>
      </F>

      <div className="card stack">
        <span className="label">Your data</span>
        <p className="small muted">A copy of everything Connect holds about you: profile, projects, reviews, vouches, clubs, questions and inbox.</p>
        <div><a className="btn ghost" href="/api/me/export" download>Download my data</a></div>
        <p className="small muted">Read the <Link href="/privacy">privacy policy</Link> and <Link href="/terms">terms</Link>.</p>
      </div>

      <F action={deleteAccount} back="/settings" className="card stack">
        <span className="label">Delete account</span>
        <p className="small muted">
          Your name, photo, emails, skills, links, resume, inbox, questions, messages and the files in them are erased, and you are signed out. Projects you were part of
          keep a “Deleted user” in their team, so your teammates&rsquo; signed history stays true. This cannot be undone.
        </p>
        <label className="field"><span>Type delete to confirm</span><input type="text" name="confirm" id="confirm" autoComplete="off" required pattern="[Dd][Ee][Ll][Ee][Tt][Ee]" /></label>
        <div><button className="btn danger">Delete my account</button></div>
      </F>
    </div>
  );
}
