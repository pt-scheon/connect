import Link from "next/link";
import { all, run } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { timeAgo } from "@/lib/notify";

export const metadata = { title: "Inbox" };

export default async function Inbox() {
  const me = await requireUser();
  const items = all("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 60", me.id);
  // Opening the inbox marks everything as read. The rows above still show what was new.
  if (items.some((n) => !n.seen)) run("UPDATE notifications SET seen=1 WHERE user_id=?", me.id);
  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <div className="head"><div className="stack tight"><h1>Inbox</h1><p>Join requests, reviews, vouches and funding, newest first.</p></div></div>
      {items.length === 0 && <div className="note">Nothing yet. You will hear here when a team answers you, a project ships or someone vouches for you.</div>}
      {items.map((n) => (
        <Link key={n.id} href={n.href} className={`card lift ${n.seen ? "" : "unread"}`}>
          <span className="row between"><span>{n.text}</span><span className="small muted mono">{timeAgo(n.created_at)}</span></span>
        </Link>
      ))}
    </div>
  );
}
