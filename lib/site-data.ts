import * as P from "./public";
import { SECTIONS } from "@/app/rule-list";
import type { Builder, BuilderDetail, College, CollegeDetail, Overview, Project, ProjectDetail } from "./site";

/* What the public pages show. Every rule about what is public lives in lib/public.ts, shared with /api/public. */
export const api = {
  overview: () => P.overview() as Overview,
  projects: (o: { college?: string; limit?: number } = {}) => P.shippedProjects(o) as Project[],
  project: (id: number) => P.shippedProject(id) as ProjectDetail | null,
  colleges: () => P.colleges() as College[],
  college: (slug: string) => P.college(slug) as CollegeDetail | null,
  builders: (limit = 20) => P.builders(limit) as Builder[],
  builder: (id: number) => P.builder(id) as BuilderDetail | null,
  rules: () => ({ sections: SECTIONS.map((s) => ({ title: s.title, intro: s.intro, rules: s.rules.map(([title, text]) => ({ title, text })) })) }),
};
