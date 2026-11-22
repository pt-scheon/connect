/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import { app } from "@/lib/site";

/* A project's cover: its own image when it has one, in the same frame. Otherwise a typographic cover: its name set
   huge on a coloured sheet, picked from the project id (stepping by 5 through 8 palettes, so neighbouring ids never
   share one). */
const PALETTES: [string, string][] = [
  ["#e0221c", "#ffffff"], // red / white
  ["#3a0300", "#ff665e"], // oxblood / red
  ["#ffb3b3", "#0f0000"], // liquid pink / black
  ["#8f1712", "#f6efed"], // brick / cream
  ["#f6efed", "#d9201a"], // cream / red
  ["#111111", "#ff8078"], // black / coral
  ["#5c100c", "#ffd5d2"], // deep red / blush
  ["#ff5a52", "#0f0000"], // bright red / black
];

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

export function Cover({ id, name, image, size = "lg" }: { id: number; name: string; image?: string | null; size?: "lg" | "sm" }) {
  const [bg, fg] = PALETTES[(id * 5) % PALETTES.length];
  if (image) return (
    <div className={`cover cover-${size} cover-has-img`} style={{ "--cbg": bg, "--cfg": fg } as CSSProperties} aria-hidden="true">
      <img className="cover-img" src={app.picture(image)} alt="" loading="lazy" decoding="async" />
    </div>
  );
  // Break camel-case product names (BusPing → BUS / PING) so the type can run edge to edge in two lines.
  const parts = name.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase().split(/\s+/);
  const mid = Math.ceil(parts.length / 2);
  const lines = parts.length > 1 ? [parts.slice(0, mid).join(" "), parts.slice(mid).join(" ")] : [name.toUpperCase()];
  const longest = Math.max(...lines.map((l) => l.length));
  return (
    <div className={`cover cover-${size}`} style={{ "--cbg": bg, "--cfg": fg, "--chars": longest } as CSSProperties} aria-hidden="true">
      {lines.map((l, i) => <span key={i} className={`cover-line ${i ? "cover-line-2" : ""}`}>{l}</span>)}
    </div>
  );
}
