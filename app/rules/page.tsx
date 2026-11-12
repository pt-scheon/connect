import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Rules } from "../rule-list";

export const metadata = { title: "How credit works" };

/* Public: anyone deciding whether to trust a Connect profile can read exactly how the number is made. */
export default async function RulesPage() {
  const me = await currentUser();
  return (
    <>
      <div className="head"><div className="stack tight">
        <h1>How credit works</h1>
        <p>Credit answers one question: did this person finish real things with other people? Nothing you type about yourself can raise it.</p>
      </div></div>
      <Rules />
      {!me && <div><Link className="btn" href="/signin">Join your college on Connect</Link></div>}
    </>
  );
}
