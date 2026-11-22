import { all, get, now, type Row } from "./db";
import { standings, skillScores } from "./auth";
import { EMPTY } from "./credit";
import { ties, pathTo } from "./graph";
import { timeAgo } from "./notify";
import { needsFor, fitsMe, type Need } from "./relevance";
import { rankBoard, viewerSignals, type FeedProject } from "./feed";
import { canon, label } from "./skills";
import { RULES } from "./rules";
import { tierFor } from "./tiers";
import { skillsOf } from "@/app/bits";
import { avatar, builders, shippedProjects, tierRef } from "./public";
import type { Builder, Project, Verdict, WorkItem } from "./site";

/* What Work and People show. Each has two scopes:
   - "college": everything inside the viewer's college. Only ever built for a verified member, of their own college.
   - "all": what is public (lib/public.ts). A member also gets the college details on their own college's rows. */

const csv = (s: unknown) => skillsOf({ skills: s } as Row);

/* One spelling per skill down a whole list, so "PostgreSQL" as typed and "Postgresql" as confirmed are one chip and
   one filter. The spellings passed in win over the confirmed labels. */
function oneSpelling(preferred: string[]) {
  const best = new Map<string, string>();
  for (const s of preferred) if (!best.has(canon(s))) best.set(canon(s), s);
  return (list: string[]) => [...new Set(list.map((s) => best.get(canon(s)) ?? label(canon(s))))];
}

/* A project's skills are stored by name, and older rows hold other spellings of the same one. */
const projectSkills = (list: string[]) => [...new Set(list.map((s) => label(canon(s))))];

/* A member's board: every project of their college they may see, their For you order, and what is beside the board. */
export function collegeWork(me: Row, college: Row) {
  const cid = college.id as number, S = standings(), mine = S.get(me.id) ?? EMPTY;
  const canReview = !!me.verified && (!!me.admin || mine.earned >= RULES.reviewerMin);
  const members = all("SELECT m.project_id, u.id, u.name, u.picture FROM members m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE m.status='active' AND p.college_id=?", cid);
  const roles = all("SELECT r.id, r.project_id, r.title FROM roles r JOIN projects p ON p.id=r.project_id WHERE r.open=1 AND p.college_id=?", cid);
  const ms = new Map(all("SELECT project_id, COUNT(*) total, SUM(done) done FROM milestones GROUP BY project_id").map((m) => [m.project_id, m]));
  const funded = new Set(all("SELECT project_id FROM grants").map((g) => g.project_id));
  const last = new Map(all("SELECT project_id, MAX(created_at) t FROM updates GROUP BY project_id").map((x) => [x.project_id, x.t]));
  // "Fits you" looks at the skills others confirmed for you first, then the ones you listed.
  const mySkills = me.role === "student" ? [...new Set([...[...(skillScores().get(me.id)?.values() ?? [])].sort((a, b) => b.score - a.score).map((k) => k.label), ...skillsOf(me)])] : [];
  const needs = new Map<number, Need[]>();
  for (const n of all("SELECT rs.* FROM role_skills rs JOIN roles r ON r.id=rs.role_id JOIN projects p ON p.id=r.project_id WHERE r.open=1 AND p.college_id=? ORDER BY rs.importance DESC", cid))
    needs.set(n.role_id, [...(needs.get(n.role_id) ?? []), { skill: n.skill, importance: n.importance }]);
  const followed = new Set(all("SELECT project_id FROM follows WHERE user_id=?", me.id).map((r) => r.project_id as number));
  const used = new Map<number, string[]>();
  for (const r of all("SELECT ps.project_id, ps.skill FROM project_skills ps JOIN projects p ON p.id=ps.project_id WHERE p.college_id=? ORDER BY ps.skill", cid))
    used.set(r.project_id, [...(used.get(r.project_id) ?? []), r.skill]);

  const rows = all("SELECT * FROM projects WHERE college_id=? ORDER BY created_at DESC", cid);
  const items: WorkItem[] = rows.map((p) => {
    const team = members.filter((m) => m.project_id === p.id).map(({ id, name, picture }) => ({ id, name, picture: picture ?? null }));
    const openRoles = roles.filter((r) => r.project_id === p.id);
    const t = Math.max(last.get(p.id) ?? 0, p.created_at ?? 0);
    const live = p.status === "recruiting" || p.status === "building";
    const shipped = p.status === "shipped";
    return {
      id: p.id, name: p.name, pitch: p.pitch, pot: shipped ? p.pot : 0, verdict: shipped ? ((p.pot >= RULES.live ? "live" : "demo") as Verdict) : null,
      shippedAt: shipped && p.shipped_at ? new Date(p.shipped_at * 1000).toISOString() : null, at: (shipped ? p.shipped_at : p.created_at) ?? 0,
      college: { slug: college.slug, name: college.name }, skills: projectSkills(used.get(p.id) ?? []), teamSize: team.length, image: p.image ?? null,
      board: {
        status: p.status, hidden: p.hidden ?? 0, done: ms.get(p.id)?.done ?? 0, total: ms.get(p.id)?.total ?? 0, team,
        open: openRoles.map((r) => r.title), funded: funded.has(p.id), mine: team.some((u) => u.id === me.id), followed: followed.has(p.id),
        fit: [...new Set(openRoles.flatMap((r) => fitsMe(needsFor(r.title, needs.get(r.id) ?? []), r.title, mySkills)))],
        active: live && t ? timeAgo(t) : "", quiet: live && t > 0 && now() - t > 14 * 86400,
      },
    };
  }).filter((p) => !p.board!.hidden || p.board!.mine || !!me.admin);

  // People two steps away: shipped with someone you shipped with.
  const T = ties(), names = new Map(all("SELECT id, name FROM users WHERE college_id=?", cid).map((u) => [u.id, u.name]));
  // For you: this person's own order of the board, with the reason for each project (lib/feed.ts).
  const raw = new Map(rows.map((p) => [p.id as number, p]));
  const wanted = new Map([...used].map(([id, list]) => [id, [...list]]));
  for (const r of roles) for (const n of needs.get(r.id) ?? [])
    if (!wanted.get(r.project_id)?.includes(n.skill)) wanted.set(r.project_id, [...(wanted.get(r.project_id) ?? []), n.skill]);
  const second = new Map<number, string>();
  for (const [mid, tiesWith] of T.get(me.id) ?? []) {
    if (!tiesWith.some((x) => x.shipped)) continue;
    for (const [other, t2] of T.get(mid) ?? []) if (other !== me.id && t2.some((x) => x.shipped) && !second.has(other)) second.set(other, names.get(mid) ?? "");
  }
  const feedProjects: FeedProject[] = items.filter((p) => !p.board!.hidden).map(({ id, board }) => ({
    id, lead: raw.get(id)?.lead_id ?? 0, status: board!.status, created: raw.get(id)?.created_at ?? 0,
    lastActive: Math.max(last.get(id) ?? 0, raw.get(id)?.created_at ?? 0), team: board!.team.map((u) => u.id),
    openRoles: board!.open.length, fit: board!.fit, skills: wanted.get(id) ?? [], followed: board!.followed, mine: board!.mine,
  }));
  const forYou = me.role === "student"
    ? rankBoard(feedProjects, { id: me.id, direct: new Set(T.get(me.id)?.keys() ?? []), second, names, ...viewerSignals(me.id, wanted) }).map((r) => ({ id: r.id, why: r.why }))
    : [];
  const near = all("SELECT id, name, picture FROM users WHERE role='student' AND verified=1 AND suspended=0 AND college_id=? AND id<>?", cid, me.id)
    .filter((u) => !T.get(me.id)?.has(u.id))
    .map((u) => ({ id: u.id as number, name: u.name as string, picture: (u.picture ?? null) as string | null, path: pathTo(T, me.id, u.id, names) }))
    .filter((x) => !x.path.startsWith("No one"))
    .slice(0, 3);
  const updates = all(
    `SELECT up.*, p.name FROM updates up JOIN projects p ON p.id=up.project_id
     WHERE p.hidden=0 AND p.status<>'dropped' AND p.college_id=? ORDER BY up.created_at DESC, up.id DESC LIMIT 8`, cid);
  const classmates = Number(get("SELECT COUNT(*) n FROM users WHERE college_id=? AND role='student' AND verified=1 AND suspended=0 AND deleted=0", cid)?.n ?? 0);
  return { items, forYou, canReview, near, updates, classmates, standing: mine };
}

/* Every shipped, public project. `own`: a member's board, for the details on their own college's projects. */
export function publicWork(own: WorkItem[] = []): WorkItem[] {
  const inside = new Map(own.map((p) => [p.id, p.board]));
  return (shippedProjects({ every: true }) as Project[]).map((p) => ({ ...p, skills: projectSkills(p.skills), at: p.shippedAt ? Date.parse(p.shippedAt) / 1000 : 0, board: inside.get(p.id) }));
}

/* Everyone verified in a member's college, themselves too, whether or not they have shipped. */
export function collegePeople(me: Row, college: Row): Builder[] {
  const S = standings(), T = ties(), K = skillScores();
  const names = new Map(all("SELECT id, name FROM users").map((u) => [u.id, u.name]));
  const rows = all("SELECT * FROM users WHERE onboarded=1 AND role='student' AND suspended=0 AND verified=1 AND college_id=?", college.id);
  const spell = oneSpelling(rows.flatMap((u) => csv(u.skills)));
  return rows.map((u) => {
    const s = S.get(u.id) ?? EMPTY;
    return {
      id: u.id, name: u.name, branch: u.branch || "", classOf: u.grad_year ?? null, college: { slug: college.slug, name: college.name },
      earned: Math.round(s.earned), shipped: s.shipped, joined: s.joined, anonymous: !!u.anon, avatar: avatar(u) ?? u.picture ?? null,
      tier: tierRef(tierFor(Math.round(s.earned), s.shipped).tier) as Builder["tier"],
      skills: spell([...csv(u.skills), ...(u.anon ? [] : [...(K.get(u.id)?.values() ?? [])].map((k) => k.label))]),
      open: !!u.open_to_join,
      inside: { left: s.left, you: u.id === me.id, path: u.id === me.id ? "" : pathTo(T, me.id, u.id, names) },
    };
  }).sort((a, b) => b.earned - a.earned || b.shipped - a.shipped);
}

/* Everyone public with shipped work. Skills here are only the ones other people confirmed, never a self-written list,
   and neither they nor "open to projects" show for someone anonymous. Both are already on the public profile.
   `own`: a member's college list, for the details on people they share a college with. */
export function publicPeople(own: Builder[] = []): Builder[] {
  const K = skillScores(), inside = new Map(own.map((b) => [b.id, b]));
  const open = new Set(all("SELECT id FROM users WHERE open_to_join=1 AND COALESCE(anon,0)=0").map((u) => u.id as number));
  const spell = oneSpelling(own.flatMap((b) => b.skills ?? []));
  return (builders(Infinity, Infinity) as Builder[]).map((b) => inside.get(b.id) ?? {
    ...b, open: open.has(b.id), skills: b.anonymous ? [] : spell([...(K.get(b.id)?.values() ?? [])].sort((x, y) => y.score - x.score).map((k) => k.label)),
  });
}
