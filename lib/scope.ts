import { redirect } from "next/navigation";
import type { Row } from "./db";
import { collegeById, isMember } from "./college";

export type View = "college" | "all";

/* Which scope of Work or People to show. Members start on their college, everyone else on every college. Asking for
   "your college" without being a member means signing in (proxy.ts notes the page to come back to) or verifying. */
export function scopeFor(me: Row | null, asked: string | undefined): { view: View; college: Row | null } {
  const member = !!me?.onboarded && isMember(me);
  if (asked === "college" && !me) redirect("/signin");
  if (asked === "college" && !member) redirect("/onboarding");
  return { view: member && asked !== "all" ? "college" : "all", college: member ? collegeById(me!.college_id)! : null };
}
