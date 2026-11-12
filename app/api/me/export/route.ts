import { all, get } from "@/lib/db";
import { currentUser, standings } from "@/lib/auth";

export const dynamic = "force-dynamic";

/* Everything Connect holds about the signed-in person, as one JSON file. */
export async function GET() {
  const me = await currentUser();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const id = me.id;
  const { sub: _sub, ...profile } = me;
  const data = {
    exported_at: new Date().toISOString(),
    profile,
    credit: standings().get(id) ?? null,
    sign_in_methods: all("SELECT sub FROM identities WHERE user_id=?", id).map((r) => String(r.sub).split(":")[0]),
    projects: all(`SELECT p.id, p.name, p.status, m.role, m.status AS membership, m.did FROM members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=?`, id),
    join_requests: all("SELECT project_id, status FROM requests WHERE user_id=?", id),
    reviews_given: all("SELECT project_id, verdict, note FROM reviews WHERE reviewer_id=?", id),
    vouches_given: all("SELECT to_id, created_at FROM vouches WHERE from_id=?", id),
    vouches_received: all("SELECT from_id, created_at FROM vouches WHERE to_id=?", id),
    claims: all("SELECT text FROM claims WHERE user_id=?", id),
    clubs: all("SELECT c.name, cm.role, cm.confirmed FROM club_members cm JOIN clubs c ON c.id=cm.club_id WHERE cm.user_id=?", id),
    questions_and_answers: all("SELECT project_id, text, created_at FROM comments WHERE user_id=?", id),
    notifications: all("SELECT text, href, seen, created_at FROM notifications WHERE user_id=?", id),
    reports_filed: all("SELECT kind, target_id, reason, created_at FROM reports WHERE by_id=?", id),
    alumni_grants: get("SELECT COUNT(*) n FROM grants WHERE alum_id=?", id)?.n ?? 0,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="connect-${id}.json"`, "Cache-Control": "no-store" },
  });
}
