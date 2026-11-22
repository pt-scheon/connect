import crypto from "crypto";
import { get, run, now, type Row } from "./db";

/* How someone appears on Connect: their own photo, or anonymous.
   Anonymous mode swaps the name and photo everyone sees (users.name and users.picture) for an alias like
   "Anon 48213097" and a GitHub-style pattern, and keeps the real ones in real_name and real_picture. Because every
   page shows users.name and users.picture as they are now, and lines the app stores hold no names (see NAME below), the
   alias appears everywhere at once. The person's college admins can still see who it is (the profile page shows them), so
   anonymity cannot be used to harass people or fake reviews. */

/* Where a name goes in a stored line (activity, inbox, team chat). The line keeps the person's id in actor_id instead
   of the name, so it follows anonymous mode, a new alias and account deletion. The slot is only ever the first or the
   last thing in a line; anywhere else it is something a person typed. */
export const NAME = "{name}";

/* A stored line as people read it, with the name that person goes by now. */
export function lineText(line: Row): string {
  const text = String(line.text ?? "");
  if (!line.actor_id) return text;
  const name = String(get("SELECT name FROM users WHERE id=?", line.actor_id)?.name ?? "Someone");
  return text.startsWith(NAME) ? name + text.slice(NAME.length) : text.endsWith(NAME) ? text.slice(0, -NAME.length) + name : text;
}

/* Ringing and joining a call pass the person's name and photo to other browsers in rows that live a minute or two.
   They take on the name as it changes, so a call that is ringing goes on ringing under the new one. */
export function renameSignals(userId: number) {
  const u = get("SELECT name, picture FROM users WHERE id=?", userId);
  if (!u) return;
  run("UPDATE call_signals SET payload=json_set(payload,'$.from.name',?,'$.from.picture',?) WHERE type='ring' AND call_id IN (SELECT id FROM voice_calls WHERE caller_id=?)", u.name, u.picture, userId);
  run("UPDATE team_signals SET payload=json_set(payload,'$.name',?,'$.picture',?) WHERE type='joined' AND from_id=?", u.name, u.picture, userId);
}

/* "Anon 48213097": like 4chan, Anon and a random eight-digit number, never already someone's name or alias. */
export function newAlias(rand: (n: number) => number = (n) => crypto.randomInt(n)): string {
  for (let i = 0; i < 50; i++) {
    let digits = String(1 + rand(9));
    for (let k = 0; k < 7; k++) digits += String(rand(10));
    const a = `Anon ${digits}`;
    if (!get("SELECT 1 FROM users WHERE alias=? OR name=?", a, a)) return a;
  }
  return `Anon ${100000000 + crypto.randomInt(900000000)}`;
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest();

/* A GitHub-style pattern: a 5×5 grid, mirrored left to right, in one colour picked from the seed. Same seed, same pattern. */
export function identicon(seed: string): string {
  const h = hash(`identicon:${seed}`);
  const hue = 354 + (h[0] % 12), sat = 55 + (h[1] % 20), light = 34 + (h[2] % 30); // red, like the rest of Connect
  const colour = `hsl(${hue} ${sat}% ${light}%)`;
  const cells: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (h[3 + y * 3 + x] % 2 === 0) continue;
    for (const cx of x === 2 ? [2] : [x, 4 - x]) cells.push(`<rect x="${cx + 0.5}" y="${y + 0.5}" width="1" height="1"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6 6" width="240" height="240" shape-rendering="crispEdges"><rect width="6" height="6" fill="#f0f0f3"/><g fill="${colour}">${cells.join("")}</g></svg>`;
}

/* A project's cover when it has no image: drawn from its name, so every project gets its own. */
export function cover(name: string): string {
  const h = hash(`cover:${name.trim().toLowerCase()}`);
  const a = Math.round((h[0] / 255) * 360), b = (a + 40 + (h[1] % 120)) % 360;
  const shapes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const x = h[2 + i * 4] % 100, y = h[3 + i * 4] % 100, r = 18 + (h[4 + i * 4] % 34), kind = h[5 + i * 4] % 3;
    const fill = `hsl(${(a % 10) - 3} 90% ${70 - i * 6}% / ${0.35 + (i % 2) * 0.2})`;
    shapes.push(kind === 0 ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`
      : kind === 1 ? `<rect x="${x - r / 2}" y="${y - r / 2}" width="${r}" height="${r}" rx="${r / 4}" fill="${fill}" transform="rotate(${h[6 + i] % 90} ${x} ${y})"/>`
      : `<polygon points="${x},${y - r} ${x + r},${y + r} ${x - r},${y + r}" fill="${fill}"/>`);
  }
  const letter = (name.trim()[0] || "?").toUpperCase().replace(/[<>&"']/g, "?");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="240" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${(a % 10) - 3} 80% ${34 + (a % 22)}%)"/><stop offset="1" stop-color="hsl(${(b % 10) - 3} 75% ${16 + (b % 18)}%)"/></linearGradient></defs>`
    + `<rect width="100" height="100" fill="url(#g)"/>${shapes.join("")}`
    + `<text x="50" y="50" dy=".35em" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="46" font-weight="700" fill="#fff" fill-opacity=".92">${letter}</text></svg>`;
}

export const identiconUrl = (alias: string) => `/api/identicon/${encodeURIComponent(alias)}`;

/* Turns anonymous mode on or off. Returns the alias in use. */
export function setAnonymous(u: Row, on: boolean, fresh = false): string | null {
  if (on) {
    const alias = !fresh && u.alias ? u.alias : newAlias();
    if (u.anon) {
      run("UPDATE users SET alias=?, name=?, picture=? WHERE id=?", alias, alias, identiconUrl(alias), u.id);
    } else {
      run("UPDATE users SET anon=1, alias=?, real_name=?, real_picture=?, name=?, picture=?, anon_since=? WHERE id=?",
        alias, u.name, u.picture ?? null, alias, identiconUrl(alias), now(), u.id);
    }
    renameSignals(u.id);
    return alias;
  }
  if (!u.anon) return null;
  run("UPDATE users SET anon=0, name=COALESCE(real_name, name), picture=real_picture, real_name=NULL, real_picture=NULL WHERE id=?", u.id);
  renameSignals(u.id);
  return null;
}

/* Where a photo goes: the one everyone sees, or, while anonymous, the kept real one. */
export function setPhoto(u: Row, url: string | null) {
  if (u.anon) run("UPDATE users SET real_picture=? WHERE id=?", url, u.id);
  else run("UPDATE users SET picture=? WHERE id=?", url, u.id);
}
/* The name and photo only the person and their college admins see. */
export const realName = (u: Row): string => (u.anon ? u.real_name ?? u.name : u.name);
