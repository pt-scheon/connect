import Link from "next/link";
import type { ReactNode } from "react";
/* Small presentational pieces shared by server and client components. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");
export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
export const skillsOf = (u: Row) => String(u.skills || "").split(",").map((s) => s.trim()).filter(Boolean);
export const monthYear = (t: number) => new Date(t * 1000).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

export function Av({ u, lg }: { u: Row; lg?: boolean }) {
  const cls = "av" + (lg ? " lg" : "");
  // eslint-disable-next-line @next/next/no-img-element
  if (u.picture) return <img className={cls} src={u.picture} alt="" title={u.name} referrerPolicy="no-referrer" />;
  return <span className={cls} title={u.name} style={{ background: `hsl(${(u.id * 67) % 360} 55% 42%)` }}>{initials(u.name)}</span>;
}
export const UserLink = ({ u }: { u: Row }) => <Link href={`/u/${u.id}`}>{u.name}</Link>;
export function Who({ u }: { u: Row }) {
  return <span className="row nowrap"><Av u={u} /><UserLink u={u} /></span>;
}

const STATUS: Record<string, [string, string]> = {
  recruiting: ["warn", "Needs people"], building: ["info", "Building"], review: ["info", "In review"],
  shipped: ["ok", "Shipped"], dropped: ["bad", "Dropped"],
};
export const statusLabel = (s: string) => STATUS[s]?.[1] ?? s;
export const Pill = ({ status }: { status: string }) => <span className={`pill ${STATUS[status]?.[0] ?? "info"}`}>{statusLabel(status)}</span>;
export const Stamp = ({ kind, children }: { kind?: "no" | "bad"; children: ReactNode }) => <span className={`stamp ${kind ?? ""}`}>{children}</span>;
export function Meter({ done, total }: { done: number; total: number }) {
  return <span className="meter" title={`${done} of ${total}`}><b style={{ width: `${total ? (100 * done) / total : 0}%` }} /></span>;
}
