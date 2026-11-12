import Anthropic from "@anthropic-ai/sdk";
import { all, get } from "./db";

export type ResumeFacts = {
  name: string; branch: string; classOf: number | null;
  projects: { name: string; about: string; role: string; did: string; teammatesWhoSigned: number; proof: string[]; shipped: string }[];
  clubs: { name: string; role: string }[];
  skills: string[];
};

/* Only records other people confirmed go in: shipped projects where the person is still on the team,
   and club roles the club lead confirmed. Self-written claims are never sent to the model. */
export function resumeFacts(userId: number): ResumeFacts {
  const u = get("SELECT * FROM users WHERE id=?", userId);
  const projects = all(
    `SELECT p.id, p.name, p.pitch, p.shipped_at, m.role, m.did FROM members m JOIN projects p ON p.id=m.project_id
     WHERE m.user_id=? AND m.status='active' AND p.status='shipped' ORDER BY p.shipped_at DESC`, userId);
  return {
    name: u.name, branch: u.branch, classOf: u.grad_year,
    projects: projects.map((p) => ({
      name: p.name, about: p.pitch, role: p.role, did: p.did,
      teammatesWhoSigned: get("SELECT COUNT(*) n FROM members WHERE project_id=? AND status='active' AND user_id<>?", p.id, userId).n,
      proof: all("SELECT label FROM proofs WHERE project_id=?", p.id).map((r) => r.label),
      shipped: new Date(p.shipped_at * 1000).toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
    })),
    clubs: all("SELECT c.name, cm.role FROM club_members cm JOIN clubs c ON c.id=cm.club_id WHERE cm.user_id=? AND cm.confirmed=1", userId),
    skills: projects.length ? String(u.skills || "").split(",").map((s: string) => s.trim()).filter(Boolean) : [],
  };
}

const SYSTEM = `You write the body of a one-page resume for a college student, as plain text.

You are given JSON facts that the student's teammates and club leads have confirmed. Use only those facts.
Do not add employers, awards, numbers, tools or skills that are not in the JSON. If a field is empty, leave it out.
Do not invent metrics. Rephrase for clarity and strength, starting bullets with a past-tense verb.

Format, with no markdown symbols other than the dashes:
PROJECTS
<Project name> | <role> | <month year>
- one to three bullets
CLUBS
- <club>, <role>
SKILLS
- comma separated list

Leave out a section that has nothing in it. Output the resume text only.`;

/* Returns the resume text, or an error message to show the person. */
export async function writeResume(facts: ResumeFacts): Promise<{ text?: string; error?: string }> {
  if (!facts.projects.length) return { error: "You need at least one shipped project before the AI has anything to write from." };
  try {
    const client = new Anthropic();
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      // If the model declines, the API retries on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    if (res.stop_reason === "refusal") return { error: "The AI declined to write this. Your template resume is unchanged." };
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return text ? { text } : { error: "The AI returned nothing. Try again." };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "The Claude API key was rejected. Check ANTHROPIC_API_KEY." };
    if (e instanceof Anthropic.RateLimitError) return { error: "The AI is busy. Try again in a minute." };
    if (e instanceof Anthropic.APIConnectionError) return { error: "Could not reach the Claude API. Check the connection and ANTHROPIC_API_KEY." };
    if (e instanceof Anthropic.APIError) return { error: `The AI request failed (status ${e.status}).` };
    return { error: "AI resume is not set up. Add ANTHROPIC_API_KEY to .env.local." };
  }
}
