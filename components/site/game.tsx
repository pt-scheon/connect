"use client";

import { useState } from "react";

const MOVES: { label: string; n: number; shipped?: number; joined?: number; note: string }[] = [
  { label: "Ship a live project with two teammates", n: 33, shipped: 1, joined: 1, note: "A fair third of a 100 pot" },
  { label: "Ship a second one that reviewers call demo-only", n: 20, shipped: 1, joined: 1, note: "A third of a 60 pot" },
  { label: "Get a vouch from someone you shipped with", n: 5, note: "Only teammates can vouch" },
  { label: "Write “AI | Web3 | Founder” in your bio", n: 0, note: "Words are worth nothing" },
  { label: "Collect 40 endorsements from friends", n: 0, note: "They never built with you" },
  { label: "Post about a hackathon you attended", n: 0, note: "Attending is not shipping" },
  { label: "Join a project, then disappear", n: -10, joined: 1, note: "Your stake is lost" },
  { label: "Start a project and drop it", n: -10, joined: 1, note: "It stays on your profile" },
];
/* Try to game it: tick moves and watch what they are worth. */
export function Game() {
  const [on, setOn] = useState<boolean[]>(() => MOVES.map((_, i) => i === 3));
  const picked = MOVES.filter((_, i) => on[i]);
  const credit = Math.max(0, 20 + picked.reduce((a, m) => a + m.n, 0));
  const shipped = picked.reduce((a, m) => a + (m.shipped ?? 0), 0), joined = picked.reduce((a, m) => a + (m.joined ?? 0), 0);
  return (
    <div className="game">
      <p className="game-score" aria-live="polite"><b>{credit}</b><span className="mono muted">credit · {shipped} shipped of {joined} joined</span></p>
      {MOVES.map((m, i) => (
        <label key={m.label} className="game-move">
          <input type="checkbox" checked={on[i]} onChange={() => setOn(on.map((x, j) => (j === i ? !x : x)))} />
          <span><span>{m.label}</span><span className="mono muted">{m.note}</span></span>
          <b className="mono">{m.n > 0 ? "+" : m.n < 0 ? "−" : ""}{Math.abs(m.n)}</b>
        </label>
      ))}
    </div>
  );
}
