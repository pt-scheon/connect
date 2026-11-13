import dns from "dns/promises";
import net from "net";

/* Checks that a project's live link really answers. Connect makes the request itself, so the link is only ever
   allowed to point at the public internet: never at this server, a private network or a cloud metadata address. */

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (x === "::" || x === "::1" || x.startsWith("::ffff:")) return false;
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("64:ff9b")) return false;
    return true;
  }
  return false;
}

/* A link Connect is willing to request: https, a real host name, the default port. */
export function liveUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) || !u.hostname.includes(".") || /\.(local|localhost|internal|test)$/i.test(u.hostname)) return null;
    return u;
  } catch { return null; }
}

export type LiveResult = { ok: boolean; status: number; note: string };

export async function checkLive(raw: string): Promise<LiveResult> {
  let u = liveUrl(raw);
  if (!u) return { ok: false, status: 0, note: "Not a public https link" };
  try {
    for (let hop = 0; hop < 4; hop++) {
      const addrs = await dns.lookup(u.hostname, { all: true });
      if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) return { ok: false, status: 0, note: "Points at a private address" };
      const r = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "ConnectLiveCheck/1.0" } });
      r.body?.cancel().catch(() => {});
      const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!next) return { ok: r.status >= 200 && r.status < 300, status: r.status, note: r.status >= 200 && r.status < 300 ? "Answered" : `Answered with an error (${r.status})` };
      const to = liveUrl(new URL(next, u).toString());
      if (!to) return { ok: false, status: r.status, note: "Redirects somewhere Connect will not follow" };
      u = to;
    }
    return { ok: false, status: 0, note: "Too many redirects" };
  } catch {
    return { ok: false, status: 0, note: "Did not answer" };
  }
}
