"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { loadChat, sendMessage, type Msg } from "../chat-actions";

type Person = { id: number; name: string; picture: string | null };

const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
function Face({ u, size = 36 }: { u: Person; size?: number }) {
  return u.picture
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="face" src={u.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    : <span className="face" style={{ width: size, height: size, background: `hsl(${(u.id * 67) % 360} 55% 42%)` }}>{initials(u.name)}</span>;
}
const time = (t: number) => new Date(t * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function day(t: number) {
  const d = new Date(t * 1000), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/* One conversation: bubbles grouped by day, new messages every few seconds, Enter to send. */
export function Chat({ other, initial, initialSeen, canSend, reason }: {
  other: Person & { branch?: string }; initial: Msg[]; initialSeen: number; canSend: boolean; reason?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [seenUpTo, setSeen] = useState(initialSeen);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [sending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const last = msgs.length ? msgs[msgs.length - 1].id : 0;
  const lastRef = useRef(last);
  lastRef.current = last;
  const router = useRouter();

  // Opening the chat marks its messages read; refresh once so the header badge drops.
  useEffect(() => { if (initial.some((m) => !m.mine)) router.refresh(); }, [other.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for new messages every 4 seconds while the tab is open.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      const r = await loadChat(other.id, lastRef.current);
      if (!alive || "error" in r) return;
      if (r.messages.length) {
        setMsgs((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))]);
        if (r.messages.some((x) => !x.mine)) router.refresh();
      }
      setSeen(r.seenUpTo);
    };
    const t = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [other.id, router]);

  useLayoutEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  // Grow the box with what you type, up to five lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight + 2, 140) + "px";
  }, [text]);

  const send = () => {
    const body = text.trim();
    if (!body || sending) return;
    setErr("");
    start(async () => {
      const r = await sendMessage(other.id, body);
      if ("error" in r) { setErr(r.error); return; }
      setText("");
      setMsgs((m) => (m.some((x) => x.id === r.message.id) ? m : [...m, r.message]));
      box.current?.focus();
    });
  };

  const lastMine = useMemo(() => [...msgs].reverse().find((m) => m.mine)?.id ?? 0, [msgs]);
  let prevDay = "";

  return (
    <section className="chat" aria-label={`Conversation with ${other.name}`}>
      <header className="chat-head">
        <Link href="/messages" className="chat-back" aria-label="All conversations">←</Link>
        <Link href={`/u/${other.id}`} className="row nowrap chat-who">
          <Face u={other} size={40} />
          <span className="stack" style={{ gap: 0 }}><b>{other.name}</b>{other.branch && <span className="small muted">{other.branch}</span>}</span>
        </Link>
      </header>

      <div className="chat-scroll" aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <Face u={other} size={72} />
            <b>{other.name}</b>
            <span className="small muted">Say hi. Ask what they are building, or pitch your project.</span>
          </div>
        )}
        {msgs.map((m, i) => {
          const d = day(m.created_at), showDay = d !== prevDay;
          prevDay = d;
          const next = msgs[i + 1];
          const tail = !next || next.mine !== m.mine || day(next.created_at) !== d || next.created_at - m.created_at > 300;
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day"><span>{d}</span></div>}
              <div className={`bubble-row ${m.mine ? "mine" : ""} ${tail ? "tail" : ""}`}>
                {!m.mine && (tail ? <Face u={other} size={28} /> : <span style={{ width: 28, flex: "none" }} />)}
                {m.kind === "invite" ? (
                  <div className="invite-card">
                    <span className="label">Project invite</span>
                    <b>{m.project_name ?? "A project"}</b>
                    <span className="small" style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                    {m.project_id && <Link className="btn sm" href={`/projects/${m.project_id}`}>{m.mine ? "Open project" : "See the project and ask to join"}</Link>}
                    <span className="bubble-time">{time(m.created_at)}</span>
                  </div>
                ) : (
                  <div className="bubble" title={new Date(m.created_at * 1000).toLocaleString("en-IN")}>
                    {m.text}
                    <span className="bubble-time">{time(m.created_at)}</span>
                  </div>
                )}
              </div>
              {m.mine && m.id === lastMine && <div className="seen">{seenUpTo >= m.id ? "Seen" : "Sent"}</div>}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {canSend ? (
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            ref={box} rows={1} value={text} maxLength={2000} placeholder={`Message ${other.name.split(" ")[0]}`} aria-label="Message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          <button className="send" disabled={!text.trim() || sending} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
          </button>
          {err && <span className="chat-err" role="alert">{err}</span>}
        </form>
      ) : <div className="chat-input note">{reason}</div>}
    </section>
  );
}

/* Start a conversation: search people at your college. */
export function NewChat({ people }: { people: (Person & { branch: string; skills: string })[] }) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => !q || `${p.name} ${p.branch} ${p.skills}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <div className="stack new-chat">
      <input type="search" id="new-chat-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people at your college by name, branch or skill" aria-label="Search people to message" autoFocus />
      <div className="people-pick">
        {list.map((p) => (
          <Link key={p.id} href={`/messages/${p.id}`} className="pick">
            <Face u={p} size={40} />
            <span className="stack" style={{ gap: 0, minWidth: 0 }}><b>{p.name}</b><span className="small muted ellipsis">{p.branch}{p.skills ? ` · ${p.skills}` : ""}</span></span>
          </Link>
        ))}
        {list.length === 0 && <span className="small muted">No one matches.</span>}
      </div>
    </div>
  );
}
