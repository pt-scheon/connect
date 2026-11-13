import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { createProject } from "../../actions";
import { F } from "../../ui";

export const metadata = { title: "Post a project" };

export default async function NewProject() {
  await requireMember();
  return (
    <div className="stack" style={{ maxWidth: 620 }}>
      <Link href="/">← All projects</Link>
      <h1>Post a project</h1>
      <F action={createProject} back="/projects/new" className="card stack">
        <label className="field"><span>Name</span><input type="text" name="name" id="name" maxLength={60} required /></label>
        <label className="field"><span>What it does, in one line</span><input type="text" name="pitch" id="pitch" maxLength={300} required /></label>
        <label className="field"><span>Your role</span><input type="text" name="myrole" id="myrole" placeholder="Lead, backend" /></label>
        <label className="field"><span>Milestones</span><textarea name="milestones" id="milestones" placeholder={"Working prototype\nTen people using it\nHanded over"} required />
          <small>One per line. All of them have to be ticked before the project can be reviewed.</small></label>
        <label className="field"><span>Skills it will use</span><input type="text" name="skills" id="skills" placeholder="React, Node, Figma" maxLength={300} />
          <small>Separated by commas. After it ships, teammates tick who used which. You can change this until review.</small></label>
        <label className="field"><span>Roles you need</span><textarea name="roles" id="roles" placeholder={"React frontend - has a Figma file ready\nRFID hardware"} />
          <small>One per line. Add a note after “ - ”. Leave empty if the team is full.</small></label>
        <div className="note">If you drop this project before it ships, you lose 10 credit and it stays on your profile.</div>
        <button className="btn">Post project</button>
      </F>
    </div>
  );
}
