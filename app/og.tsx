import { ImageResponse } from "next/og";

/* Shared look for link previews: dark card, the two-circle mark, a big title and a row of stats. */
export const ogSize = { width: 1200, height: 630 };

export function ogCard({ eyebrow, title, subtitle, stats, stamp }: {
  eyebrow: string; title: string; subtitle?: string; stats?: [string, string][]; stamp?: string;
}) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px",
        background: "#131313", color: "#F1F0EC", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", position: "relative", width: 76, height: 44 }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: 44, height: 44, borderRadius: 22, background: "#F5B921" }} />
            <div style={{ position: "absolute", left: 30, top: 0, width: 44, height: 44, borderRadius: 22, background: "#BDBBB5" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Connect</div>
          <div style={{ marginLeft: "auto", fontSize: 24, color: "#A3A19A" }}>{eyebrow}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: title.length > 26 ? 68 : 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 30, color: "#C9C6BF", lineHeight: 1.3, maxWidth: 1000 }}>{subtitle}</div> : null}
          {stamp ? (
            <div style={{ display: "flex" }}>
              <div style={{ fontSize: 22, color: "#4FC79C", border: "2px solid #4FC79C", borderRadius: 6, padding: "6px 14px", letterSpacing: 2 }}>{stamp}</div>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {(stats ?? []).map(([n, label]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", padding: "18px 26px", borderRadius: 18, background: "#1B1B1B", border: "1px solid #2C2B2A" }}>
              <div style={{ fontSize: 44, fontWeight: 700 }}>{n}</div>
              <div style={{ fontSize: 22, color: "#A3A19A" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    ogSize,
  );
}
