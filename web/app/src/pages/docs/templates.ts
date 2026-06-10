export interface DocTemplate {
  id: string;
  name: string;
  subtitle: string;
  /** Seed HTML inserted into the new document (empty for a blank doc). */
  html: string;
}

// Built-in templates shown in the "Start a new document" gallery. Selecting one
// creates a new document seeded with its HTML (via the editor's seed handoff).
export const TEMPLATES: DocTemplate[] = [
  { id: "blank", name: "Blank document", subtitle: "", html: "" },
  {
    id: "project-proposal",
    name: "Project proposal",
    subtitle: "Tropic",
    html: `<h1>Project Name</h1><p><em>Prepared by — Your Name · ${"{date}"}</em></p>
<h2>Overview</h2><p>Briefly describe the project, its goals, and why it matters.</p>
<h2>Objectives</h2><ul><li>Objective one</li><li>Objective two</li><li>Objective three</li></ul>
<h2>Scope</h2><p>What is in scope, and what is explicitly out of scope.</p>
<h2>Timeline</h2><p>Key milestones and target dates.</p>
<h2>Budget</h2><p>Estimated cost and resourcing.</p>`,
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    subtitle: "Modern Writer",
    html: `<h1>Meeting notes</h1><p><strong>Date:</strong> ${"{date}"} &nbsp; <strong>Attendees:</strong> </p>
<h2>Agenda</h2><ul><li>Item one</li><li>Item two</li></ul>
<h2>Notes</h2><p>Discussion summary…</p>
<h2>Action items</h2><ul data-type="taskList"><li data-checked="false">Owner — task</li></ul>`,
  },
  {
    id: "brochure",
    name: "Brochure",
    subtitle: "Geometric",
    html: `<h1>Your Company</h1><h2>Product Brochure</h2>
<p>A short, punchy intro to your product and the problem it solves.</p>
<h2>Features</h2><ul><li>Feature one</li><li>Feature two</li><li>Feature three</li></ul>
<h2>Get in touch</h2><p>hello@yourcompany.com · yourcompany.com</p>`,
  },
  {
    id: "newsletter",
    name: "Newsletter",
    subtitle: "Lively",
    html: `<h1>We have a surprise!</h1><p><em>Your monthly update</em></p>
<h2>What's new</h2><p>Lead story…</p>
<h2>Highlights</h2><ul><li>Highlight one</li><li>Highlight two</li></ul>
<p>Thanks for reading — see you next month.</p>`,
  },
  {
    id: "letter",
    name: "Business letter",
    subtitle: "Geometric",
    html: `<p>Your Name<br>Your Company<br>${"{date}"}</p>
<p>Dear [Recipient],</p>
<p>Opening paragraph stating the purpose of your letter.</p>
<p>Body paragraph with supporting details.</p>
<p>Closing paragraph with a call to action.</p>
<p>Sincerely,<br>Your Name</p>`,
  },
];

/** templateHtml returns a template's HTML with placeholders filled in. */
export function templateHtml(t: DocTemplate): string {
  return t.html.replaceAll("{date}", new Date().toLocaleDateString());
}
