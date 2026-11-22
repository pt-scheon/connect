/* The page a signed-out person was trying to open, kept for ten minutes so signing in lands there (proxy.ts sets it). */
export const AFTER_COOKIE = "after_signin";
const PAGES = /^\/(work|people|clubs|funding|commissions|projects|credit|admin|inbox|messages|settings|feedback|share)([/?]|$)/;

/* Only one of Connect's own member pages is ever accepted, so this cannot send anyone to another site. */
export function afterPath(v: string | null | undefined): string {
  if (!v || v.length > 300 || !PAGES.test(v) || /[\\\s\u0000-\u001f]/.test(v)) return "/work";
  const path = v.split("?")[0];
  return path.includes("//") || path.includes("..") ? "/work" : v;
}
