import Link from "next/link";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { CONSENT_COOKIE, readConsent } from "@/lib/consent";
import { setConsent } from "../actions";
import { ConsentChoice } from "../consent";

export const metadata = { title: "Cookies", description: "Every cookie Connect sets, what it is for and how long it lasts, and your choice about statistics." };

/* Every cookie the site sets. Keep this in step with the code: lib/auth.ts (sid), app/settings-menu.tsx (theme),
   app/actions.ts and the sign-in routes (pending, td, oauth_state), lib/consent.ts (consent). */
const COOKIES: [name: string, kind: string, what: string, lasts: string][] = [
  ["sid", "Necessary", "Keeps you signed in. Signed, so it cannot be forged.", "30 days, or until you sign out"],
  ["oauth_state", "Necessary", "Protects the sign-in with Google or LinkedIn from being hijacked.", "10 minutes"],
  ["pending", "Necessary", "Remembers that you passed the first sign-in step while you type an emailed code.", "10 minutes"],
  ["td", "Necessary", "Remembers a device you chose to trust, so it is not asked for a code again.", "90 days"],
  ["theme", "Preference", "Light, dark or device appearance, if you picked one.", "1 year"],
  ["consent", "Necessary", "Your answer below, so the notice is not shown again.", "1 year"],
];

export default async function Cookies() {
  const me = await currentUser();
  const saved = readConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  const current = saved ?? (me?.stats_on === 0 ? "necessary" : null);
  return (
    <article className="card narrow prose">
      <h1>Cookies and statistics</h1>
      <p className="muted small">Last updated 21 November 2026</p>
      <p>Connect sets only the cookies it needs to work. There are no advertising cookies, no tracking across other sites, and no analytics services like Google Analytics.</p>

      <h2>The cookies</h2>
      <div className="tw">
        <table className="cookie-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">What it does</th><th scope="col">Lasts</th></tr></thead>
          <tbody>
            {COOKIES.map(([name, kind, what, lasts]) => (
              <tr key={name}><th scope="row"><code>{name}</code></th><td>{kind}</td><td>{what}</td><td>{lasts}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Your browser also keeps the notification address if you turn on alerts, and the installed app keeps a small helper (a service worker) so calls can ring while Connect is closed. Neither tracks you.</p>

      <h2>Statistics</h2>
      <p>When you are signed in, Connect counts which days you open it and how many pages you load on each, not which pages. Admins see these only added up across everyone, as charts, never per person. It is counted on Connect&rsquo;s own server and needs no cookie. Deleting your account deletes the counts.</p>
      <ConsentChoice action={setConsent} current={current} />
      {me?.onboarded ? <p className="small muted">The same switch is in <Link href="/settings#privacy">Settings</Link>.</p> : null}

      <p>See also the <Link href="/privacy">privacy policy</Link> and the <Link href="/terms">terms</Link>.</p>
    </article>
  );
}
