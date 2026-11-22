import { ImageResponse } from "next/og";

/* Shared look for link previews: dark card, the two-circle mark, a big title and a row of stats. */
export const ogSize = { width: 1200, height: 630 };

export function ogCard({ eyebrow, title, subtitle, stats, stamp }: {
  eyebrow: string; title: string; subtitle?: string; stats?: [string, string][]; stamp?: string;
}) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px",
        background: "#0F0000", color: "#F0EDE8", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", position: "relative", width: 76, height: 44 }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: 44, height: 44, borderRadius: 0, background: "#E0221C" }} />
            <div style={{ position: "absolute", left: 30, top: 0, width: 44, height: 44, borderRadius: 0, background: "#8A4843" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Connect</div>
          <div style={{ marginLeft: "auto", fontSize: 24, color: "#BDA9A7" }}>{eyebrow}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: title.length > 26 ? 68 : 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 30, color: "#E0C9C7", lineHeight: 1.3, maxWidth: 1000 }}>{subtitle}</div> : null}
          {stamp ? (
            <div style={{ display: "flex" }}>
              <div style={{ fontSize: 22, color: "#FF665E", border: "2px solid #FF665E", borderRadius: 0, padding: "6px 14px", letterSpacing: 2 }}>{stamp}</div>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {(stats ?? []).map(([n, label]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", padding: "18px 26px", borderRadius: 0, background: "#1C0A09", border: "1px solid #3A1F1C" }}>
              <div style={{ fontSize: 44, fontWeight: 700 }}>{n}</div>
              <div style={{ fontSize: 22, color: "#BDA9A7" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    ogSize,
  );
}
