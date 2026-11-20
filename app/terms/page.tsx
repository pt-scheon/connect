import Link from "next/link";

export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <article className="card narrow prose">
      <h1>Terms</h1>
      <p className="muted small">Last updated 20 November 2026</p>
      <p>Connect is a place for the people of a community, like the students of a college or the employees of a workplace, to find teammates, build projects and show what shipped. By using it you agree to the following.</p>

      <h2>Be who you say you are</h2>
      <ul>
        <li>One account per person. Use your real name and your own college or work email.</li>
        <li>Connect is for communities, like the students of a college or the employees of a workplace, and their alumni. If you are under 18, you need the consent of a parent or guardian to use it.</li>
        <li>Only list projects and contributions you actually worked on. Credit only counts what teammates and reviewers sign, and gaming it (fake teams, swapped reviews, vouch rings) gets accounts suspended.</li>
      </ul>

      <h2>Be decent</h2>
      <ul>
        <li>No harassment, hate, spam, or content you do not have the right to share.</li>
        <li>Admins can hide projects and suspend accounts that break these rules. Anyone can report a project or person.</li>
      </ul>

      <h2>Your work stays yours</h2>
      <p>You own what you build and post. You let Connect show it on the site so others can see it, and you can remove it or delete your account at any time from <Link href="/settings">Settings</Link>.</p>

      <h2>Alumni funding</h2>
      <p>Grants are agreements between an alum and a project team. Connect records them and shows what was paid, but does not handle money and is not responsible for whether a grant is paid.</p>

      <h2>Commissions</h2>
      <ul>
        <li>A commission is one person asking another to build something, for credit. Graded coursework, assignments, lab records, reports handed in for marks, exams and anything else you submit for a grade are not allowed, whether you are asking or doing.</li>
        <li>Anyone can report a commission as coursework. One an admin finds to be coursework is removed: nobody is paid, the reward is not returned, and it goes on the record of the person who posted it.</li>
        <li>Only alumni and clubs can attach money to a commission. Connect records the amount and whether it was marked as paid. It does not handle money and is not responsible for whether it is paid.</li>
        <li>Disputes are decided by the admins of your community.</li>
      </ul>

      <h2>No guarantees</h2>
      <p>Connect is provided as it is. Credit is a record of signed work, not a grade or a reference. We may change these terms; the date above shows the latest version.</p>

      <p>See also the <Link href="/privacy">privacy policy</Link> and <Link href="/rules">how credit works</Link>.</p>
    </article>
  );
}
