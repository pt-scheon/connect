import { redirect } from "next/navigation";
import { all } from "@/lib/db";
import { currentUser, devLogin } from "@/lib/auth";
import { readyProviders } from "@/lib/oauth";
import { devSignIn } from "../actions";
import { Av } from "../ui";
import { SignInButtons } from "./buttons";

export const metadata = { title: "Sign in" };

export default async function SignIn() {
  if (await currentUser()) redirect("/");
  const people = devLogin ? all("SELECT * FROM users WHERE suspended=0 ORDER BY role DESC, name LIMIT 30") : [];
  const missing = devLogin && readyProviders().length < 2;
  return (
    <div className="stack narrow">
      <div className="card">
        <h1>Sign in to Connect</h1>
        <p className="muted">For students and alumni of one college. Build things with each other, and let the record speak.</p>
        <SignInButtons />
        <p className="small muted">We get your name, photo and email. Students then confirm a college email, unless they signed in with it. Alumni are approved by an admin.</p>
        {missing && <div className="note">Development note: a button without keys in <code>.env.local</code> sends you back here with a message. See the README for the two-minute setup.</div>}
      </div>
      {devLogin && (
        <div className="card">
          <span className="label">Development only</span>
          <p className="small muted">Sign in as a sample person. This list never appears in production.</p>
          {people.length === 0 && <p className="small">No sample people yet. Run <code>npm run seed</code>.</p>}
          {people.map((u) => (
            <form key={u.id} action={devSignIn} className="row between">
              <input type="hidden" name="id" value={u.id} />
              <span className="row nowrap"><Av u={u} /><span>{u.name} <span className="muted small">{u.role === "alum" ? "alum" : u.branch}{u.admin ? " · admin" : ""}</span></span></span>
              <button className="btn ghost sm">Sign in</button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
