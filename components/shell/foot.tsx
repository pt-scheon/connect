import { Go } from "./go";
import { Clock } from "@/components/site/clock";

export function Foot({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="sh-end">
      <p className="sh-end-mark" aria-hidden="true">connect<span /></p>
      <div className="sh-end-bar">
        <Clock />
        <span>© {new Date().getFullYear()} Connect</span>
        <nav aria-label="More">
          <Go signedIn={signedIn} href="/rules">Credit rules</Go><Go signedIn={signedIn} href="/colleges">Colleges</Go><Go signedIn={signedIn} href="/privacy">Privacy</Go>
          <Go signedIn={signedIn} href="/terms">Terms</Go><Go signedIn={signedIn} href="/cookies">Cookies</Go><Go signedIn={signedIn} href="/feedback">Feedback</Go>
        </nav>
      </div>
    </footer>
  );
}
