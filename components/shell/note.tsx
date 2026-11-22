import { demoMode } from "@/lib/auth";
import { hasSampleData } from "@/lib/public";

/* Says when the people on screen are invented. */
export function SampleNote({ className }: { className: string }) {
  if (demoMode) return <p className={className} role="note">Test site with invented sample people. Nothing here is real. The real Connect is at <a href="https://connect-production-77ec4d79.up.railway.app">connect-production-77ec4d79.up.railway.app</a>.</p>;
  if (!hasSampleData()) return null;
  return <p className={className} role="note">Sample data: most people, projects and numbers here are invented. The colleges are real, but have not joined or endorsed Connect.</p>;
}
