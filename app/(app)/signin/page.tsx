import Link from "next/link";
import { redirect } from "next/navigation";
import { all } from "@/lib/db";
import { currentUser, demoMode, devLogin } from "@/lib/auth";
import { sampleSql } from "@/lib/sample";
import { readyProviders } from "@/lib/oauth";
import { devSignIn } from "@/app/actions";
import { Av } from "@/app/ui";
import { Name } from "@/app/bits";
import { SignInButtons } from "./buttons";
import "./signin.css";

export const metadata = { title: "Sign in" };

/* Sign in, in the public pages' look: red light falling into black, the CONNECT wordmark, big light type
   and mono captions. It sits under the one header. */
export default async function SignIn() {
  if (await currentUser()) redirect("/work");
  const people = devLogin ? all(`SELECT u.*, c.name college FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE ${sampleSql("u.sub")} AND u.super=0 AND u.suspended=0 AND u.deleted=0 ORDER BY u.sub LIKE 'seed:%' DESC, u.admin DESC, c.name, u.role DESC, u.name LIMIT 40`) : [];
  const missing = devLogin && !demoMode && readyProviders().length < 2;
  return (
    <div className="sx">
      <div className="sx-word" aria-hidden="true">CONNECT</div>
      <div className="sx-main">
        <h1>Sign in.</h1>
        <p className="sx-lead">Credit only for what ships. Students build it, teammates sign it.</p>
        <div className="sx-buttons"><SignInButtons /></div>
        <p className="sx-mono">We get your name, photo and email. Members then confirm a college or work email, unless they signed in with it. Alumni are approved by an admin. By continuing you agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.</p>
        <details className="sx-help">
          <summary>Trouble signing in?</summary>
          <p><b>Forgot your password?</b> Connect has no password of its own. You sign in with your Google or LinkedIn account, so reset it there: <a href="https://accounts.google.com/signin/recovery" target="_blank" rel="noopener noreferrer">recover a Google account</a> or <a href="https://www.linkedin.com/uas/request-password-reset" target="_blank" rel="noopener noreferrer">reset a LinkedIn password</a>. Then come back and sign in.</p>
          <p><b>No sign-in code in your email?</b> Check spam, wait a minute, then press &ldquo;send a new code&rdquo;. The code goes to your college or work address.</p>
          <p><b>Landed on an empty new account?</b> You probably picked a different account from the one you joined with. Sign out, then choose the Google or LinkedIn account you used the first time.</p>
          <p><b>Lost a phone or used a shared computer?</b> Sign in on a device you trust, open Settings and press <b>Sign out of all other devices</b>.</p>
          <p><b>Told your account is suspended?</b> Only an admin of your community can restore it.</p>
        </details>
        {missing && <p className="sx-mono">Development note: a button without keys in <code>.env.local</code> sends you back here with a message.</p>}
        {devLogin && (
          <section className="sx-people" aria-label="Sample people">
            <p className="sx-mono">{demoMode ? "Test site: sign in as an invented person. Nothing here is real." : "Development only: sign in as a sample person."}</p>
            {people.length === 0 && <p className="sx-mono">No sample people yet. Run <code>npm run seed</code>.</p>}
            {people.map((u) => (
              <form key={u.id} action={devSignIn} className="sx-person">
                <input type="hidden" name="id" value={u.id} />
                <span className="sx-who"><Av u={u} /><span><Name name={u.name} /> <span className="sx-dim">{u.college ?? "no community yet"}{u.role === "alum" ? " · alum" : ""}{u.admin ? " · admin" : ""}</span></span></span>
                <button className="sx-pill">Sign in</button>
              </form>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
