import { ImageResponse } from "next/og";

/* The Connect mark (two overlapping circles) as a square PNG, for phone home screens. */
export function markPng(size: number, padded = false) {
  const r = Math.round(size * (padded ? 0.2 : 0.22)); // circle radius; maskable icons keep a safe margin
  const cx = size / 2, gap = Math.round(r * 0.9);
  const dot = (x: number, color: string, opacity = 1) => (
    <div style={{ position: "absolute", left: x - r, top: size / 2 - r, width: r * 2, height: r * 2, borderRadius: r, background: color, opacity }} />
  );
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", position: "relative", background: "#0A0B14", borderRadius: padded ? 0 : size * 0.22 }}>
        {dot(cx - gap / 2, "#F5B921")}
        {dot(cx + gap / 2, "#8B95FF", 0.93)}
      </div>
    ),
    { width: size, height: size },
  );
}
