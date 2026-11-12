import { all, get } from "./db";
import { askGemini } from "./gemini";

const SYSTEM = `You write a neutral summary for an outside reviewer who needs to check proof of a student project.

Rules:
- Write at most five short bullet lines telling the reviewer what to check.
- Be completely neutral and objective. Do not give a verdict, recommendation, rating, or score.
- You must state plainly that you have not opened the links.
- Focus on what the reviewer should verify based on the claimed pitch, milestones, members' contributions, and proof links.
- Format with no markdown symbols other than dashes for bullets:
- <bullet line>`;

export async function proofSummary(
  projectId: number
): Promise<{ text?: string; error?: string }> {
  const project = get(
    "SELECT name, pitch FROM projects WHERE id=?",
    projectId
  ) as { name: string; pitch: string } | undefined;

  if (!project) {
    return { error: "Project not found." };
  }

  const milestones = all(
    "SELECT title, done FROM milestones WHERE project_id=?",
    projectId
  ) as { title: string; done: number }[];

  const proofs = all(
    "SELECT label, url FROM proofs WHERE project_id=?",
    projectId
  ) as { label: string; url: string }[];

  const members = all(
    "SELECT role, did FROM members WHERE project_id=? AND status='active'",
    projectId
  ) as { role: string; did: string }[];

  const facts = {
    project: {
      name: project.name,
      pitch: project.pitch,
    },
    milestones: milestones.map((m) => ({
      title: m.title,
      done: Boolean(m.done),
    })),
    proofs: proofs.map((pr) => ({
      label: pr.label,
      url: pr.url,
    })),
    activeMembers: members.map((m) => ({
      role: m.role || "Member",
      did: m.did || "",
    })),
  };

  return askGemini(SYSTEM, JSON.stringify(facts));
}
