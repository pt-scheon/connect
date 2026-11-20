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
  return <span className={cls} title={u.name} style={{ background: AVATAR[Math.abs(Number(u.id) || 0) % AVATAR.length] }}>{initials(u.name)}</span>;
}
/* Muted, deep tones so white initials stay readable (4.5:1 or better). */
export const AVATAR = ["#2f5d50", "#8a3b12", "#3b4e8c", "#6b3a6e", "#6f5200", "#1f6f78", "#5c4a37", "#8c2f39"];
/* A project's mark: its first letter in a square. Decorative only. */
export function PIcon({ id, name, lg }: { id: number; name: string; lg?: boolean }) {
  return <span className={`picon${lg ? " lg" : ""}`} aria-hidden="true">{(name.trim()[0] || "?").toUpperCase()}</span>;
}
export const UserLink = ({ u }: { u: Row }) => <Link href={`/u/${u.id}`}>{u.name}</Link>;
export function Who({ u }: { u: Row }) {
  return <span className="row nowrap"><Av u={u} /><UserLink u={u} /></span>;
}

const STATUS: Record<string, [string, string]> = {
  recruiting: ["warn", "Needs people"], building: ["info", "Building"], review: ["purple", "In review"],
  shipped: ["ok shipped", "Shipped"], dropped: ["bad", "Dropped"],
};
export const statusLabel = (s: string) => STATUS[s]?.[1] ?? s;
export const Pill = ({ status }: { status: string }) => <span className={`pill ${STATUS[status]?.[0] ?? "info"}`}>{statusLabel(status)}</span>;
export const Stamp = ({ kind, children }: { kind?: "no" | "bad"; children: ReactNode }) => <span className={`stamp ${kind ?? ""}`}>{children}</span>;
export function Meter({ done, total }: { done: number; total: number }) {
  return <span className="meter" title={`${done} of ${total}`}><b style={{ width: `${total ? (100 * done) / total : 0}%` }} /></span>;
}
