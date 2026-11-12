import { requireUser, standings } from "@/lib/auth";
import { EMPTY } from "@/lib/credit";
import { Rules } from "../rule-list";

export const metadata = { title: "Credit" };

export default async function Credit() {
  const me = await requireUser();
  const s = standings().get(me.id) ?? EMPTY;
  return (
    <>
      <div className="head"><div className="stack tight">
        <h1>How credit works</h1>
        <p>Credit answers one question: did this person finish real things with other people? Nothing you type about yourself can raise it.</p>
      </div></div>
      {me.role === "student" && (
        <div className="card" style={{ maxWidth: 620 }}>
          <h2>Your ledger</h2>
          <div className="tw"><table><tbody>
            {s.ledger.length === 0 && <tr><td className="muted">Nothing yet. Verify your college email to get your starter credit.</td></tr>}
            {s.ledger.map((l, i) => (
              <tr key={i}><td><b>{l.what}</b><br /><span className="small muted">{l.why}</span></td><td className={`n ${l.n < 0 ? "neg" : ""}`}>{l.n > 0 ? "+" : "−"}{Math.abs(l.n)}</td></tr>
            ))}
            <tr><td><b>Total</b></td><td className="n"><b>{s.credit}</b></td></tr>
          </tbody></table></div>
        </div>
      )}
      <Rules />
    </>
  );
}
