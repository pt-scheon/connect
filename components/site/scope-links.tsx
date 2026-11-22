import Link from "next/link";
import type { View } from "@/lib/scope";

/* Your college, or every college. A plain link for someone who must sign in first, so proxy.ts sees the request. */
export function ScopeLinks({ base, view, member }: { base: "/work" | "/people"; view: View; member: boolean }) {
  const current = (v: View) => (view === v ? "page" : undefined);
  return (
    <nav className="scope" aria-label="Whose to show">
      {member
        ? <Link href={`${base}?scope=college`} aria-current={current("college")}>Your college</Link>
        : <a href={`${base}?scope=college`}>Your college</a>}
      <Link href={`${base}?scope=all`} aria-current={current("all")}>All colleges</Link>
    </nav>
  );
}
