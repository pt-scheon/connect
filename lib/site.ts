/* Types and small helpers for the public pages (app/(site)). Safe in the browser: the data itself comes from
   lib/site-data.ts, which only runs on the server. */

export type CollegeRef = { slug: string; name: string };
export type Verdict = "live" | "demo";

/* Ranks (backend lib/tiers.ts): from earned credit, and from Gold up shipped projects too. Every tier has five
   divisions, 1 to 5 (Bronze 5 moves up to Silver 1). `id` is the tier (colours, emblem); `name` reads "Bronze 3". */
export type TierId = "rookie" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "legend";
export type TierRef = { id: TierId; key: string; division: number; tier: string; name: string; note: string };
export type Rank = TierRef & { next: (TierRef & { progress: number; needs: string[] }) | null };
/* A picture path on Connect: an uploaded photo or, for anonymous people, their pattern. null means initials. */
export type Avatar = string | null;

export type Overview = {
  sample?: boolean; // invented sample people are in the data
  stats: { members: number; shipped: number; building: number; colleges: number; committedInr: number };
  rules: { starter: number; stake: number; live: number; demo: number; reviewsNeeded: number; reviewerMin: number; soloFactor: number; fadeMonths: number; vouch: number };
  tiers: { id: TierId; name: string; note: string; minCredit: number; minShipped: number; divisions: { division: number; name: string; minCredit: number }[] }[];
};
export type Project = {
  id: number; name: string; pitch: string; pot: number; verdict: Verdict; shippedAt: string | null;
  college: CollegeRef; skills: string[]; teamSize: number;
  /* The project's image, a path on Connect (the sample data's are drawn by backend/scripts/sample-art.js). null: none. */
  image: string | null;
};
export type ProjectDetail = Project & {
  proof: string[];
  team: { id: number; name: string; branch: string; classOf: number | null; role: string; did: string; signedBy: number; avatar: Avatar; tier: TierRef }[];
  hiddenTeammates: number;
};
export type CollegeCounts = { members: number; shipped: number; building: number; alumni: number };
/* opened: a community opened for real students, rather than one the sample data made. real: its counts without invented people. */
type Registration = { opened?: boolean; real?: CollegeCounts };
export type College = CollegeRef & { since: string | null } & CollegeCounts & Registration;
export type CollegeDetail = CollegeRef & { since: string | null; domains: string[]; counts: CollegeCounts; shipped: Project[] } & Registration;
export type Builder = {
  id: number; name: string; branch: string; classOf: number | null; college: CollegeRef; earned: number; shipped: number; joined: number;
  anonymous: boolean; avatar: Avatar; tier: TierRef;
  /* On People (lib/directory.ts). skills: outside your college, only ones other people confirmed.
     inside: only ever set for people at the viewer's own college. */
  skills?: string[]; open?: boolean; inside?: { left: number; you: boolean; path: string };
};
/* A project on Work. board: only ever set for a project at the viewer's own college. */
export type WorkItem = Omit<Project, "verdict"> & {
  verdict: Verdict | null; at: number;
  board?: {
    status: string; hidden: number; done: number; total: number; team: { id: number; name: string; picture: string | null }[];
    open: string[]; funded: boolean; mine: boolean; followed: boolean; fit: string[]; active: string; quiet: boolean;
  };
};
export type Progress = {
  step: number; // days between points
  points: { day: string; credit: number }[];
  reached: { at: string | null; tier: TierRef }[];
  recent: { at: string | null; what: string; why: string; n: number; total: number }[];
};
export type BuilderDetail = Omit<Builder, "tier"> & {
  rank: Rank;
  projects: { id: number; name: string; pitch: string; verdict: Verdict; shippedAt: string | null; image: string | null; role: string; did: string; signedBy: number; proof: string[] }[];
  clubs: { name: string; role: string }[];
  /* null for anonymous builders: Connect hides their record. */
  progress: Progress | null;
};
export type Skill = { skill: string; projects: number };

export const app = {
  signin: "/signin",
  rules: "/rules",
  privacy: "/privacy",
  terms: "/terms",
  cookies: "/cookies",
  college: (slug: string) => `/colleges/${slug}`,
  picture: (src: string) => src,
};

export const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : "");
export const monthYear = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "";
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
