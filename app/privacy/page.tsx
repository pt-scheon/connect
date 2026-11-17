import Link from "next/link";

export const metadata = { title: "Privacy" };

/* Plain-language privacy policy. Also the page Google asks for before the sign-in app can be published. */
export default function Privacy() {
  const contact = process.env.CONTACT_EMAIL;
  return (
    <article className="card narrow prose">
      <h1>Privacy</h1>
      <p className="muted small">Last updated 13 November 2026</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>From Google or LinkedIn sign-in:</b> your name, email address and profile photo. Nothing else, and we never see your password.</li>
        <li><b>From you:</b> branch, graduation year, skills, a line about you, optional GitHub, LinkedIn and website links, and your college email if you verify with a code.</li>
        <li><b>From using Connect:</b> projects you post or join, milestones, proof links, reviews, vouches, credit splits, questions, club roles and funding applications.</li>
        <li><b>From messages and calls:</b> the messages you send, and the photos, videos, files and voice notes you attach. For calls we keep a log of who called whom, when, and for how long. Calls are not recorded.</li>
        <li><b>If you turn on alerts:</b> an address your browser gives us for that device, so we can send it notifications. Turning alerts off removes it.</li>
      </ul>

      <h2>What is public</h2>
      <p>Verified students have a profile page anyone with the link can open: name, photo, branch, year, skills, links, projects and credit. Your email addresses are never shown to anyone, only the college domain you verified with. Reviews are shown without the reviewer&rsquo;s name.</p>
      <p>Everything else stays inside your college: projects in progress, people lists, clubs and funding are visible only to verified members of the same college. Messages and their attachments can be opened only by the two people in the chat. A college&rsquo;s public page shows only its counts and shipped projects.</p>

      <h2>How it is used</h2>
      <ul>
        <li>To run Connect: showing projects, working out credit, sending you inbox alerts and, if you leave them on, emails about them.</li>
        <li>If you press <b>Write with AI</b> on your resume, your signed project facts are sent to Google&rsquo;s Gemini API to write it. If a reviewer presses <b>What should I check?</b>, that project&rsquo;s proof links and milestones are sent. Nothing else is sent to it.</li>
        <li>Calls connect directly between the two browsers where possible, which means the other person&rsquo;s device can see your network address, as with most calling apps. When a direct connection is not possible, the encrypted call passes through a relay run by Cloudflare.</li>
        <li>Alerts are delivered by the notification service of your browser or phone maker (Google, Apple or Mozilla).</li>
        <li>We do not sell your data, show ads, or share it with anyone except the services that run the site: hosting, email delivery, Gemini, Cloudflare&rsquo;s call relay and your browser&rsquo;s notification service.</li>
      </ul>

      <h2>Cookies</h2>
      <p>One cookie keeps you signed in, one remembers light or dark mode, and one lasts a few minutes while you sign in with Google or LinkedIn. No tracking or advertising cookies.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Turn email alerts off, switch calls off, choose who can start a chat with you, sign out of your other devices, download everything we hold about you, or delete your account from <Link href="/settings">Settings</Link>.</li>
        <li>Deleting erases your personal details. Your place in past project teams stays as &ldquo;Deleted user&rdquo;, so your teammates&rsquo; history remains accurate.</li>
      </ul>

      <h2>Age</h2>
      <p>Connect is for college students and alumni. If you are under 18, use it only with the consent of a parent or guardian.</p>

      <h2>Contact</h2>
      <p>Questions or requests: {contact ? <>email <a href={`mailto:${contact}`}>{contact}</a>, or </> : null}use <b>Report</b> on the project or profile concerned. Once signed in you can also write to the team from <Link href="/feedback">Feedback</Link>; we keep what you send there, with the page you came from, until you delete your account.</p>
    </article>
  );
}
