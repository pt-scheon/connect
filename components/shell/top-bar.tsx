import { get } from "@/lib/db";
import { currentUser, standings } from "@/lib/auth";
import { collegeById, isMember } from "@/lib/college";
import { unreadMessages } from "@/lib/chat";
import { navCounts } from "@/lib/public";
import { signOut } from "@/app/actions";
import { TopNav, type TopUser } from "./top-nav";

/* The one header, on public and members' pages alike. `over`: it floats over the page (public pages open with a hero). */
export async function TopBar({ over = false }: { over?: boolean }) {
  const u = await currentUser();
  let me: TopUser | null = null;
  if (u) {
    const member = !!u.onboarded && isMember(u), college = member ? collegeById(u.college_id) : null;
    me = {
      id: u.id, name: u.name, picture: u.picture ?? null, onboarded: !!u.onboarded, member,
      admin: !!u.onboarded && !!u.admin,
      college: college ? { slug: college.slug, name: college.name } : null,
      credit: u.role === "student" && u.onboarded ? (standings().get(u.id)?.credit ?? 0) : null,
      inbox: u.onboarded ? get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND seen=0", u.id)!.n : 0,
      messages: member ? unreadMessages(u.id) : 0,
    };
  }
  return <TopNav over={over} me={me} counts={navCounts()} signOut={signOut} />;
}
