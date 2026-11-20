"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { loadTeamChat, sendTeamMessage, type TeamMsg } from "../../team-actions";
import { prepare } from "../../messages/chat";
import { AVATAR } from "../../bits";

type Mate = { id: number; name: string; picture: string | null; role: string; lead: boolean };
type Pending = { id: string; file: File; url: string; progress: number; error?: string };

const MAX_PHOTO = 8 * 1024 * 1024, AT_ONCE = 6;
const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const time = (t: number) => new Date(t * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function day(t: number) {
  const d = new Date(t * 1000), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
/* Each role gets its own colour, the same everywhere, so a glance tells who is who. */
const TAG_COLOURS = ["blue", "purple", "teal", "pink", "indigo", "green", "red"];
const tagColour = (role: string) => TAG_COLOURS[[...role.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TAG_COLOURS.length];

export function RoleTag({ role, lead }: { role: string; lead?: boolean }) {
  return <span className="role-tags">{lead && <span className="role-tag lead">Lead</span>}<span className={`role-tag ${tagColour(role)}`}>{role}</span></span>;
}
function Face({ u, size = 32 }: { u: { id: number; name: string; picture: string | null }; size?: number }) {
  return u.picture
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="face" src={u.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    : <span className="face" style={{ width: size, height: size, background: AVATAR[Math.abs(u.id) % AVATAR.length] }}>{initials(u.name)}</span>;
}

/* Uploads one photo to the team chat, with progress. */
function upload(project: number, p: { file: File; w?: number; h?: number }, caption: string, onProgress: (n: number) => void): Promise<{ message?: TeamMsg; error?: string }> {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append("project", String(project)); fd.append("file", p.file); fd.append("caption", caption);
    if (p.w) fd.append("w", String(p.w)); if (p.h) fd.append("h", String(p.h));
    const x = new XMLHttpRequest();
    x.open("POST", "/api/team/attach");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch { resolve({ error: "Upload failed." }); } };
    x.onerror = () => resolve({ error: "Upload failed. Check your connection." });
    x.send(fd);
  });
}

/* The team's group chat: everyone's name with their role tag, photos, and lines when people join or leave. */
export function TeamChat({ project, name, team, initial }: { project: number; name: string; team: Mate[]; initial: TeamMsg[] }) {
  const [msgs, setMsgs] = useState<TeamMsg[]>(initial);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [sending, start] = useTransition();
  const [files, setFiles] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<TeamMsg | null>(null);
  const picker = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const lastRef = useRef(0);
  lastRef.current = msgs.length ? msgs[msgs.length - 1].id : 0;

  // New messages every 4 seconds while the tab is open.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      const r = await loadTeamChat(project, lastRef.current);
      if (!alive || "error" in r || !r.messages.length) return;
      setMsgs((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))]);
    };
    const t = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", tick);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [project]);

  useLayoutEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight + 2, 140) + "px";
  }, [text, files.length]);

  const addFiles = (list: FileList | File[]) => {
    setErr("");
    const incoming = [...list], room = AT_ONCE - files.length;
    if (incoming.length > room) setErr(`Up to ${AT_ONCE} photos at a time.`);
    const next: Pending[] = [];
    for (const f of incoming.slice(0, Math.max(0, room))) {
      if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(f.type) && !/\.(jpe?g|png|webp|gif|heic)$/i.test(f.name)) { setErr(`${f.name}: only photos can be sent here.`); continue; }
      if (f.size > MAX_PHOTO * 3) { setErr(`${f.name} is too big.`); continue; }
      next.push({ id: `${Date.now()}-${Math.random()}`, file: f, url: URL.createObjectURL(f), progress: 0 });
    }
    if (next.length) setFiles((x) => [...x, ...next]);
  };
  const drop = (id: string) => setFiles((x) => { const gone = x.find((p) => p.id === id); if (gone) URL.revokeObjectURL(gone.url); return x.filter((p) => p.id !== id); });
  const add = (m: TeamMsg) => setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]));

  const sendPhotos = async () => {
    setUploading(true); setErr("");
    let caption = text.trim();
    for (const p of files) {
      const ready = await prepare(p.file);
      if (ready.file.size > MAX_PHOTO) { setErr(`${p.file.name} is too big even after shrinking.`); setFiles((x) => x.map((y) => (y.id === p.id ? { ...y, error: "Too big" } : y))); continue; }
      const r = await upload(project, ready, caption, (n) => setFiles((x) => x.map((y) => (y.id === p.id ? { ...y, progress: n } : y))));
      if (r.error || !r.message) { setErr(r.error ?? "Upload failed."); setFiles((x) => x.map((y) => (y.id === p.id ? { ...y, error: r.error } : y))); break; }
      caption = ""; setText(""); add(r.message); drop(p.id);
    }
    setUploading(false);
    box.current?.focus();
  };
  const send = () => {
    if (files.length) { if (!uploading) void sendPhotos(); return; }
    const body = text.trim();
    if (!body || sending) return;
    setErr("");
    start(async () => {
      const r = await sendTeamMessage(project, body);
      if ("error" in r) { setErr(r.error); return; }
      setText(""); add(r.message); box.current?.focus();
    });
  };

  let prevDay = "";
  return (
    <section className={`chat team-chat ${dragging ? "dragging" : ""}`} aria-label={`${name} team chat`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      {dragging && <div className="drop-hint">Drop photos to send</div>}
      <header className="chat-head">
        <Link href={`/projects/${project}`} className="chat-back" aria-label={`Back to ${name}`}>←</Link>
        <span className="stack" style={{ gap: 0, minWidth: 0 }}><b className="ellipsis">{name}</b><span className="small muted">Team chat · {team.length} {team.length === 1 ? "person" : "people"}</span></span>
      </header>
      <div className="team-roster" aria-label="The team">
        {team.map((u) => <span key={u.id} className="roster-chip"><Face u={u} size={22} /><span className="ellipsis">{u.name.split(" ")[0]}</span><RoleTag role={u.role} lead={u.lead} /></span>)}
      </div>

      <div className="chat-scroll" aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <b>Say hello to your team</b>
            <span className="small muted">Only the people on {name} can read this chat. Plan the next milestone, share screenshots, ask for help.</span>
          </div>
        )}
        {msgs.map((m, i) => {
          const d = day(m.created_at), showDay = d !== prevDay;
          prevDay = d;
          if (m.kind === "system") return <div key={m.id}>{showDay && <div className="chat-day"><span>{d}</span></div>}<div className="team-system"><span>{m.text}</span></div></div>;
          const prev = msgs[i - 1], next = msgs[i + 1];
          const sameAs = (o?: TeamMsg) => !!o && o.kind !== "system" && o.from?.id === m.from?.id && day(o.created_at) === d && Math.abs(o.created_at - m.created_at) < 300;
          const head = !sameAs(prev) || showDay, tail = !sameAs(next);
          const who = m.from!;
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day"><span>{d}</span></div>}
              {head && !m.mine && <div className="team-who"><b>{who.name}</b><RoleTag role={who.gone ? "Former member" : who.role} lead={who.lead && !who.gone} /></div>}
              <div className={`bubble-row ${m.mine ? "mine" : ""} ${tail ? "tail" : ""}`}>
                {!m.mine && (tail ? <Link href={`/u/${who.id}`} aria-label={who.name}><Face u={who} size={28} /></Link> : <span style={{ width: 28, flex: "none" }} />)}
                {m.file ? (
                  <div className="photo-msg">
                    <button type="button" className="photo" onClick={() => setView(m)} aria-label={`Open photo from ${who.name}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/files/${m.file.key}`} alt={m.text || `Photo from ${who.name}`} loading="lazy"
                        onLoad={() => { if (i >= msgs.length - 3) end.current?.scrollIntoView({ block: "end" }); }}
                        width={m.file.w ?? undefined} height={m.file.h ?? undefined}
                        style={m.file.w && m.file.h ? { aspectRatio: `${m.file.w} / ${m.file.h}` } : undefined} />
                    </button>
                    {m.text && <div className="bubble caption">{m.text}</div>}
                    <span className="bubble-time">{time(m.created_at)}</span>
                  </div>
                ) : (
                  <div className="bubble" title={new Date(m.created_at * 1000).toLocaleString("en-IN")}>{m.text}<span className="bubble-time">{time(m.created_at)}</span></div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {files.length > 0 && (
          <div className="tray" aria-label="Photos to send">
            {files.map((p) => (
              <div key={p.id} className={`tray-item ${p.error ? "bad" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" />
                {uploading && !p.error ? <span className="tray-bar"><b style={{ width: `${Math.round(p.progress * 100)}%` }} /></span>
                  : <button type="button" className="tray-x" onClick={() => drop(p.id)} aria-label={`Remove ${p.file.name}`}>×</button>}
              </div>
            ))}
          </div>
        )}
        <button type="button" className="attach" onClick={() => picker.current?.click()} disabled={uploading || files.length >= AT_ONCE} aria-label="Send photos" title="Send photos">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
        </button>
        <button type="button" className="attach cam-only" onClick={() => camera.current?.click()} disabled={uploading || files.length >= AT_ONCE} aria-label="Take a photo" title="Take a photo">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
        </button>
        <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <textarea ref={box} rows={1} value={text} maxLength={2000} placeholder={files.length ? "Add a caption (optional)" : "Message the team"} aria-label="Message the team"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button className="send" disabled={(!text.trim() && !files.length) || sending || uploading} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
        </button>
        {err && <span className="chat-err" role="alert">{err}</span>}
      </form>

      {view?.file && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setView(null)}
          onKeyDown={(e) => e.key === "Escape" && setView(null)} tabIndex={-1} ref={(el) => el?.focus()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${view.file.key}`} alt={view.text || "Photo"} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span className="small">{view.from?.name}{view.text ? `: ${view.text}` : ""}</span>
            <a className="btn sm ghost" href={`/api/files/${view.file.key}?download=1`}>Download</a>
            <button type="button" className="btn sm" onClick={() => setView(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
