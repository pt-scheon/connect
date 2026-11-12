import { RULES as R } from "@/lib/credit";

/* The credit rules in plain words. Shown on the public rules page and the signed-in credit page. */
export const RULE_TEXT: [string, string][] = [
  ["Only shipped work earns credit", `A project is worth ${R.live} if it is live and in use, ${R.demo} if it works but is only a repo or demo. Ideas, posts and certificates are worth 0.`],
  ["Outsiders decide what it is worth", `Two people who were not on the team, each with ${R.reviewerMin}+ credit, open the proof and choose. The stricter verdict wins. They can also send it back.`],
  ["Teammates set your share", "Each teammate splits 100 between the others. Your share is the middle value of what they gave you. You never rate yourself."],
  ["Joining costs a stake", `Asking to join holds ${R.stake} credit. It comes back when the project ships. If you leave, or two thirds of the team mark you as gone, it is lost.`],
  ["Dropping a project costs the lead", `A lead who drops a project loses ${R.stake} credit and it stays on their profile. Teammates get their stakes back.`],
  ["Vouches are limited", `Only people who shipped with you can vouch, once each. A vouch is worth up to ${R.vouch}, less from someone with little credit, and half if you vouched for each other.`],
  ["Closed circles are flagged", "If all your shipped work is with the same one or two people, your profile says so."],
  ["Old credit fades", `Credit from a project shipped more than ${R.fadeMonths} months ago counts half. Solo projects earn half, since no one else can sign for them.`],
];

export function Rules() {
  return <div className="grid">{RULE_TEXT.map(([t, d]) => <div key={t} className="card"><h3>{t}</h3><p>{d}</p></div>)}</div>;
}
