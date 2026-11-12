"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Voice and video calls, for any page of the app. One CallProvider lives in the layout; it listens for rings,
   runs the WebRTC connection, and draws the call screen. CallButtons anywhere start a call through it. */

type Peer = { id: number; name: string; picture: string | null };
type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
type State = { phase: Phase; id?: number; video?: boolean; peer?: Peer; note?: string };
type Ev = { type: string; call: number; payload: Record<string, unknown> | null };

const START = "connect:call";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function CallButtons({ to, name, picture = null }: { to: number; name: string; picture?: string | null }) {
  const go = (video: boolean) => window.dispatchEvent(new CustomEvent(START, { detail: { video, peer: { id: to, name, picture } } }));
  return (
    <>
      <button type="button" className="call-btn" onClick={() => go(false)} aria-label={`Voice call ${name}`} title="Voice call">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
      </button>
      <button type="button" className="call-btn" onClick={() => go(true)} aria-label={`Video call ${name}`} title="Video call">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
      </button>
    </>
  );
}

function Face({ u, size }: { u: Peer; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return u.picture ? <img className="call-face" src={u.picture} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    : <span className="call-face" style={{ width: size, height: size, fontSize: size / 2.6, background: `hsl(${(u.id * 67) % 360} 55% 42%)` }}>{u.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>;
}

/* Ringtone and ringback, made with the Web Audio API so there are no sound files to load. */
function tone(kind: "ring" | "back") {
  let ctx: AudioContext | null = null, stop = false;
  try { ctx = new AudioContext(); } catch { return () => {}; }
  const beep = (f: number, at: number, len: number) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain();
    o.frequency.value = f; o.connect(g); g.connect(ctx!.destination);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(kind === "ring" ? 0.18 : 0.08, at + 0.02);
    g.gain.setValueAtTime(kind === "ring" ? 0.18 : 0.08, at + len - 0.05); g.gain.linearRampToValueAtTime(0, at + len);
    o.start(at); o.stop(at + len);
  };
  const cycle = () => {
    if (stop || !ctx) return;
    const t = ctx.currentTime;
    if (kind === "ring") { beep(880, t, 0.25); beep(660, t + 0.3, 0.25); beep(880, t + 0.6, 0.25); beep(660, t + 0.9, 0.25); }
    else { beep(425, t, 0.4); beep(425, t + 0.6, 0.4); }
    setTimeout(cycle, kind === "ring" ? 2400 : 3000);
  };
  void ctx.resume().then(cycle);
  return () => { stop = true; void ctx?.close(); };
}

export function CallProvider() {
  const [s, setS] = useState<State>({ phase: "idle" });
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true), [sharing, setSharing] = useState(false);
  const [theirs, setTheirs] = useState({ mic: true, cam: true });
  const [secs, setSecs] = useState(0), [mini, setMini] = useState(false), [net, setNet] = useState(""), [err, setErr] = useState("");
  const device = useRef("");
  const state = useRef(s); state.current = s;
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const ice = useRef<RTCIceServer[]>([]);
  const queue = useRef<RTCIceCandidateInit[]>([]);
  const restarted = useRef(false);
  const stopTone = useRef<() => void>(() => {});
  const startedAt = useRef(0);
  const remoteV = useRef<HTMLVideoElement>(null), localV = useRef<HTMLVideoElement>(null), remoteA = useRef<HTMLAudioElement>(null);
  const remoteStream = useRef<MediaStream | null>(null);

  const api = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, device: device.current }) });
    return r.json().catch(() => ({ error: "Network error." }));
  }, []);
  const sig = useCallback((type: string, payload: unknown) => { const id = state.current.id; if (id) void api({ action: "signal", id, type, payload }); }, [api]);

  const cleanup = useCallback((note?: string) => {
    stopTone.current(); stopTone.current = () => {};
    pc.current?.close(); pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null; camTrack.current = null;
    remoteStream.current = null; queue.current = []; restarted.current = false;
    setSharing(false); setMic(true); setCam(true); setTheirs({ mic: true, cam: true }); setNet(""); setMini(false);
    document.title = document.title.replace(/^📞 /, "");
    if (note) { setS((x) => ({ ...x, phase: "ended", note })); setTimeout(() => setS((x) => (x.phase === "ended" ? { phase: "idle" } : x)), 2200); }
    else setS({ phase: "idle" });
  }, []);

  const media = useCallback(async (video: boolean) => {
    const m = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    local.current = m; camTrack.current = m.getVideoTracks()[0] ?? null;
    if (localV.current) localV.current.srcObject = m;
    return m;
  }, []);

  const connect = useCallback(() => {
    const p = new RTCPeerConnection({ iceServers: ice.current });
    pc.current = p;
    local.current?.getTracks().forEach((t) => p.addTrack(t, local.current!));
    p.ontrack = (e) => {
      const rs = remoteStream.current ?? (remoteStream.current = new MediaStream());
      if (!rs.getTracks().includes(e.track)) rs.addTrack(e.track);
      if (remoteV.current) remoteV.current.srcObject = rs;
      if (remoteA.current) { remoteA.current.srcObject = rs; void remoteA.current.play().catch(() => {}); }
    };
    p.onicecandidate = (e) => e.candidate && sig("ice", e.candidate.toJSON());
    p.onconnectionstatechange = async () => {
      const cs = p.connectionState;
      if (cs === "connected") {
        stopTone.current(); setNet("");
        if (!startedAt.current) startedAt.current = Date.now();
        setS((x) => ({ ...x, phase: "active" }));
      } else if (cs === "disconnected") setNet("Reconnecting…");
      else if (cs === "failed") {
        // One automatic retry with fresh routes; the caller makes the new offer.
        const caller = state.current.phase !== "incoming" && (p as unknown as { _caller?: boolean })._caller;
        if (!restarted.current && caller) {
          restarted.current = true; setNet("Reconnecting…");
          const o = await p.createOffer({ iceRestart: true }); await p.setLocalDescription(o); sig("offer", o);
        } else if (!restarted.current) { restarted.current = true; setNet("Reconnecting…"); }
        else {
          const id = state.current.id;
          if (id) void api({ action: "end", id, failed: true });
          cleanup("Could not connect. This network may block calls.");
        }
      }
    };
    return p;
  }, [api, cleanup, sig]);

  const flush = async () => { const p = pc.current; if (!p?.remoteDescription) return; for (const c of queue.current.splice(0)) await p.addIceCandidate(c).catch(() => {}); };

  // Events from the server.
  const onEvent = useCallback(async (ev: Ev) => {
    const cur = state.current, pl = ev.payload ?? {};
    if (ev.type === "ring") {
      if (cur.phase !== "idle" && cur.phase !== "ended") return;
      setS({ phase: "incoming", id: ev.call, video: !!pl.video, peer: pl.from as Peer });
      stopTone.current = tone("ring");
      navigator.vibrate?.([400, 200, 400, 200, 400]);
      if (!document.title.startsWith("📞")) document.title = "📞 " + document.title;
      return;
    }
    if (ev.call !== cur.id) return;
    if (ev.type === "taken" && pl.device !== device.current && cur.phase === "incoming") { stopTone.current(); cleanup(); return; }
    if (ev.type === "ended") {
      const why = pl.status === "declined" ? "Declined" : pl.status === "missed" ? "No answer" : pl.status === "failed" ? "Call failed" : "Call ended";
      cleanup(why);
      return;
    }
    if (ev.type === "accepted" && cur.phase === "outgoing") {
      stopTone.current(); setS((x) => ({ ...x, phase: "connecting" }));
      const p = connect(); (p as unknown as { _caller?: boolean })._caller = true;
      const o = await p.createOffer(); await p.setLocalDescription(o); sig("offer", o);
      return;
    }
    const p = pc.current;
    if (ev.type === "offer") {
      const q = p ?? connect();
      await q.setRemoteDescription(pl as unknown as RTCSessionDescriptionInit);
      await flush();
      const a = await q.createAnswer(); await q.setLocalDescription(a); sig("answer", a);
    } else if (ev.type === "answer" && p) {
      await p.setRemoteDescription(pl as unknown as RTCSessionDescriptionInit); await flush();
    } else if (ev.type === "ice") {
      if (p?.remoteDescription) await p.addIceCandidate(pl as RTCIceCandidateInit).catch(() => {}); else queue.current.push(pl as RTCIceCandidateInit);
    } else if (ev.type === "media") setTheirs({ mic: pl.mic !== false, cam: pl.cam !== false });
  }, [cleanup, connect, sig]);

  // Listen for calls on every page while signed in.
  useEffect(() => {
    device.current = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9-]/gi, "").slice(0, 36);
    const es = new EventSource(`/api/calls/events?device=${device.current}`);
    es.addEventListener("call", (e) => void onEvent(JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  }, [onEvent]);

  // Starting a call from a CallButtons anywhere on the page.
  useEffect(() => {
    const go = async (e: Event) => {
      const { video, peer } = (e as CustomEvent).detail as { video: boolean; peer: Peer };
      if (state.current.phase !== "idle" && state.current.phase !== "ended") return;
      setErr("");
      setS({ phase: "outgoing", video, peer, note: "Starting…" });
      try { await media(video); } catch {
        setS({ phase: "idle" }); setErr(video ? "Allow the camera and microphone to make a video call." : "Allow the microphone to make a call."); return;
      }
      const r = await api({ action: "start", to: peer.id, video });
      if (r.error) { cleanup(); setErr(r.error); return; }
      ice.current = r.ice; startedAt.current = 0;
      setS({ phase: "outgoing", id: r.id, video, peer, note: r.online ? "Ringing…" : "Calling… (they may not have Connect open)" });
      stopTone.current = tone("back");
    };
    window.addEventListener(START, go);
    return () => window.removeEventListener(START, go);
  }, [api, cleanup, media]);

  // Call timer.
  useEffect(() => {
    if (s.phase !== "active") return;
    const t = setInterval(() => setSecs(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [s.phase]);

  // Hang up if the tab closes mid-call.
  useEffect(() => {
    const bye = () => { const id = state.current.id; if (id && state.current.phase !== "idle") navigator.sendBeacon?.("/api/calls", new Blob([JSON.stringify({ action: "end", id, device: device.current })], { type: "application/json" })); };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  // Keep video elements attached when the layout switches between full screen and minimised.
  useEffect(() => {
    if (localV.current && local.current) localV.current.srcObject = local.current;
    if (remoteV.current && remoteStream.current) remoteV.current.srcObject = remoteStream.current;
  });

  const accept = async () => {
    const cur = state.current; if (!cur.id) return;
    stopTone.current(); setErr("");
    try { await media(!!cur.video); } catch {
      setErr(cur.video ? "Allow the camera and microphone to answer." : "Allow the microphone to answer."); return;
    }
    setS((x) => ({ ...x, phase: "connecting" }));
    const r = await api({ action: "accept", id: cur.id });
    if (r.error) { cleanup(r.error); return; }
    ice.current = r.ice; startedAt.current = 0;
    if (!pc.current) connect();
    document.title = document.title.replace(/^📞 /, "");
  };
  const decline = () => { const id = state.current.id; if (id) void api({ action: "decline", id }); cleanup(); };
  const hangup = () => { const id = state.current.id; if (id) void api({ action: "end", id }); cleanup(state.current.phase === "active" ? "Call ended" : undefined); };

  const toggleMic = () => { const on = !mic; local.current?.getAudioTracks().forEach((t) => (t.enabled = on)); setMic(on); sig("media", { mic: on, cam }); };
  const toggleCam = () => { const on = !cam; if (camTrack.current) camTrack.current.enabled = on; setCam(on); sig("media", { mic, cam: on }); };
  const flip = async () => {
    const cur = camTrack.current?.getSettings().facingMode;
    try {
      const m = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cur === "environment" ? "user" : "environment" } });
      const t = m.getVideoTracks()[0];
      await pc.current?.getSenders().find((x) => x.track?.kind === "video")?.replaceTrack(t);
      camTrack.current?.stop(); camTrack.current = t;
      const l = local.current!; l.getVideoTracks().forEach((x) => l.removeTrack(x)); l.addTrack(t);
      if (localV.current) localV.current.srcObject = l;
    } catch { setErr("This device has only one camera."); }
  };
  const share = async () => {
    const sender = pc.current?.getSenders().find((x) => x.track?.kind === "video");
    if (!sender) return;
    if (sharing) { await sender.replaceTrack(camTrack.current); setSharing(false); return; }
    try {
      const d = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const t = d.getVideoTracks()[0];
      await sender.replaceTrack(t); setSharing(true);
      t.onended = () => { void sender.replaceTrack(camTrack.current); setSharing(false); };
    } catch { /* cancelled */ }
  };

  if (s.phase === "idle") return err ? <div className="call-toast" role="alert" onClick={() => setErr("")}>{err}</div> : null;
  const peer = s.peer!;
  const live = s.phase === "active" || s.phase === "connecting";
  const status = s.phase === "incoming" ? `Incoming ${s.video ? "video" : "voice"} call` : s.phase === "outgoing" ? s.note ?? "Calling…"
    : s.phase === "connecting" ? "Connecting…" : s.phase === "ended" ? s.note : net || clock(secs);

  return (
    <div className={`call-screen ${mini ? "mini" : ""} ${s.video && live ? "has-video" : ""}`} role="dialog" aria-modal={!mini} aria-label={`Call with ${peer.name}`}>
      {s.video && <video ref={remoteV} className="call-remote" autoPlay playsInline />}
      <audio ref={remoteA} autoPlay />
      {(!s.video || !live || !theirs.cam) && (
        <div className="call-id">
          <span className={`call-pulse ${s.phase === "incoming" || s.phase === "outgoing" ? "on" : ""}`}><Face u={peer} size={mini ? 44 : 112} /></span>
          {!mini && <b className="call-name">{peer.name}</b>}
        </div>
      )}
      <div className="call-top">
        {s.video && live && <b>{peer.name}</b>}
        <span className="call-status" aria-live="polite">{status}{live && !theirs.mic ? " · they are muted" : ""}</span>
      </div>
      {s.video && <video ref={localV} className={`call-local ${cam ? "" : "off"}`} autoPlay playsInline muted />}
      {err && <div className="call-err" role="alert">{err}</div>}

      <div className="call-controls">
        {s.phase === "incoming" ? (
          <>
            <button type="button" className="cc end" onClick={decline} aria-label="Decline"><Icon d="hang" /></button>
            <button type="button" className="cc accept" onClick={accept} aria-label="Accept"><Icon d={s.video ? "video" : "phone"} /></button>
          </>
        ) : s.phase === "ended" ? null : (
          <>
            <button type="button" className={`cc ${mic ? "" : "off"}`} onClick={toggleMic} aria-pressed={!mic} aria-label={mic ? "Mute" : "Unmute"}><Icon d={mic ? "mic" : "micoff"} /></button>
            {s.video && <button type="button" className={`cc ${cam ? "" : "off"}`} onClick={toggleCam} aria-pressed={!cam} aria-label={cam ? "Turn camera off" : "Turn camera on"}><Icon d={cam ? "video" : "videooff"} /></button>}
            {s.video && live && !mini && <button type="button" className="cc" onClick={flip} aria-label="Switch camera"><Icon d="flip" /></button>}
            {s.video && live && !mini && "getDisplayMedia" in (navigator.mediaDevices ?? {}) && <button type="button" className={`cc hide-sm ${sharing ? "off" : ""}`} onClick={share} aria-pressed={sharing} aria-label={sharing ? "Stop sharing screen" : "Share screen"}><Icon d="screen" /></button>}
            {live && <button type="button" className="cc" onClick={() => setMini(!mini)} aria-label={mini ? "Expand call" : "Minimise call"}><Icon d={mini ? "expand" : "shrink"} /></button>}
            <button type="button" className="cc end" onClick={hangup} aria-label="End call"><Icon d="hang" /></button>
          </>
        )}
      </div>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  const p: Record<string, React.ReactNode> = {
    phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />,
    hang: <path transform="rotate(135 12 12)" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />,
    video: <><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>,
    videooff: <><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M2 2l20 20" /></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></>,
    micoff: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M2 2l20 20" /></>,
    flip: <><path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M9 13a3 3 0 0 0 5.2 2M15 13a3 3 0 0 0-5.2-2" /></>,
    screen: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6" /></>,
    shrink: <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
    expand: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[d]}</svg>;
}
