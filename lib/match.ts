/* Suggests people for an open role. Skills a person used in shipped projects count for far more
   than skills they only listed, so the suggestions follow the same rule as credit: proof first. */

/* Words that often appear in role titles, and the skills they usually mean. */
const RELATED: Record<string, string[]> = {
  frontend: ["react", "next.js", "nextjs", "vue", "angular", "javascript", "typescript", "html", "css", "ui"],
  backend: ["node", "python", "fastapi", "django", "flask", "java", "go", "sql", "postgres", "api"],
  mobile: ["flutter", "react native", "android", "ios", "kotlin", "swift"],
  app: ["flutter", "react native", "android", "ios"],
  hardware: ["esp32", "arduino", "embedded c", "pcb design", "sensors", "stm32", "verilog", "fpga"],
  rfid: ["esp32", "arduino", "embedded c", "sensors"],
  firmware: ["embedded c", "esp32", "stm32", "arduino"],
  ml: ["ml", "python", "pytorch", "tensorflow", "ai"],
  search: ["ml", "python", "elasticsearch", "ai"],
  design: ["figma", "ui design", "product", "ui"],
  ui: ["figma", "ui design", "react"],
  control: ["pid", "control systems", "matlab", "embedded c", "mechanisms"],
  pid: ["control systems", "matlab", "embedded c"],
  cad: ["cad", "3d printing", "mechanisms"],
  mechanical: ["cad", "3d printing", "mechanisms"],
};

export type Candidate = { id: number; skills: string[]; credit: number; shipped: number; left: number; open?: boolean };
export type Suggestion = { id: number; score: number; matched: string[]; backed: boolean; open: boolean };

const norm = (s: string) => s.toLowerCase().trim();
const words = (s: string) => norm(s).split(/[^a-z0-9.+#]+/).filter(Boolean);

/* The skills a role title asks for: the title's own words plus related skills. */
export function roleSkills(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(title)) {
    out.add(w);
    for (const r of RELATED[w] ?? []) out.add(r);
  }
  return out;
}

function matches(skill: string, wanted: Set<string>) {
  const s = norm(skill);
  if (wanted.has(s)) return true;
  // "React" matches "react frontend"; "Embedded C" matches "embedded"
  return words(s).some((w) => w.length > 2 && wanted.has(w));
}

export function suggest(title: string, people: Candidate[], limit = 3): Suggestion[] {
  const wanted = roleSkills(title);
  return people
    .map((p) => {
      const matched = p.skills.filter((k) => matches(k, wanted));
      const backed = p.shipped > 0;
      // A listed skill with nothing shipped is worth a third of a proven one. Saying you are open to join adds a little.
      const score = matched.length * (backed ? 3 : 1) + Math.min(p.credit, 200) / 100 - p.left * 1.5 + (p.open ? 1 : 0);
      return { id: p.id, score, matched, backed, open: !!p.open };
    })
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* The skills from a person's list that an open role asks for. Used for the board's "Fits you" filter. */
export function fitFor(title: string, skills: string[]): string[] {
  const wanted = roleSkills(title);
  return skills.filter((k) => matches(k, wanted));
}
