import type {
  Team,
  Issue,
  Project,
  Label,
  Comment,
  Member,
  TeamMember,
  IssuePatch,
  GitLink,
} from "./types";

const API_BASE = "/api/v1";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

const qs = (params: Record<string, string | undefined>): string => {
  const e = Object.entries(params).filter(([, v]) => v) as [string, string][];
  return e.length ? "?" + new URLSearchParams(e).toString() : "";
};

// ── Members ──
export async function listMembers(): Promise<Member[]> {
  const r = await jsonFetch<{ members: Member[] }>("/projects/members");
  return r.members ?? [];
}

// ── Teams ──
export async function listTeams(): Promise<Team[]> {
  const r = await jsonFetch<{ teams: Team[] }>("/projects/teams");
  return r.teams ?? [];
}
export function createTeam(body: {
  name: string;
  key: string;
  color?: string;
  icon?: string;
}): Promise<Team> {
  return jsonFetch<Team>("/projects/teams", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateTeam(
  id: string,
  body: { name: string; color?: string; icon?: string },
): Promise<Team> {
  return jsonFetch<Team>(`/projects/teams/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export async function deleteTeam(id: string): Promise<void> {
  await jsonFetch<unknown>(`/projects/teams/${id}`, { method: "DELETE" });
}

// ── Team members ──
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const r = await jsonFetch<{ members: TeamMember[] }>(
    `/projects/teams/${teamId}/members`,
  );
  return r.members ?? [];
}
export async function addTeamMember(
  teamId: string,
  userId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/projects/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}
export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/projects/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
}

// ── Assignable (org or team-scoped) ──
export async function listAssignable(teamId?: string): Promise<Member[]> {
  const r = await jsonFetch<{ members: Member[] }>(
    "/projects/assignable" + qs({ team_id: teamId }),
  );
  return r.members ?? [];
}

// ── Issues ──
export async function listIssues(
  filter: {
    team_id?: string;
    project_id?: string;
    assignee_id?: string;
    status?: string;
    parent_issue_id?: string;
  } = {},
): Promise<Issue[]> {
  const r = await jsonFetch<{ issues: Issue[] }>(
    "/projects/issues" + qs(filter),
  );
  return r.issues ?? [];
}
export function getIssue(id: string): Promise<Issue> {
  return jsonFetch<Issue>(`/projects/issues/${id}`);
}
export function createIssue(body: {
  team_id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  assignee_id?: string;
  label_ids?: string[];
  project_id?: string;
  estimate?: number;
  parent_issue_id?: string;
}): Promise<Issue> {
  return jsonFetch<Issue>("/projects/issues", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateIssue(id: string, patch: IssuePatch): Promise<Issue> {
  return jsonFetch<Issue>(`/projects/issues/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
export async function deleteIssue(id: string): Promise<void> {
  await jsonFetch<unknown>(`/projects/issues/${id}`, { method: "DELETE" });
}

// ── Projects ──
export async function listProjects(): Promise<Project[]> {
  const r = await jsonFetch<{ projects: Project[] }>("/projects/projects");
  return r.projects ?? [];
}
export function createProject(body: Partial<Project>): Promise<Project> {
  return jsonFetch<Project>("/projects/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateProject(
  id: string,
  body: Partial<Project>,
): Promise<Project> {
  return jsonFetch<Project>(`/projects/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export async function deleteProject(id: string): Promise<void> {
  await jsonFetch<unknown>(`/projects/projects/${id}`, { method: "DELETE" });
}

// ── Labels ──
export async function listLabels(): Promise<Label[]> {
  const r = await jsonFetch<{ labels: Label[] }>("/projects/labels");
  return r.labels ?? [];
}
export function createLabel(body: {
  name: string;
  color?: string;
}): Promise<Label> {
  return jsonFetch<Label>("/projects/labels", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export async function deleteLabel(id: string): Promise<void> {
  await jsonFetch<unknown>(`/projects/labels/${id}`, { method: "DELETE" });
}

// ── Comments ──
export async function listComments(issueId: string): Promise<Comment[]> {
  const r = await jsonFetch<{ comments: Comment[] }>(
    `/projects/issues/${issueId}/comments`,
  );
  return r.comments ?? [];
}
export function createComment(issueId: string, body: string): Promise<Comment> {
  return jsonFetch<Comment>(`/projects/issues/${issueId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// ── Git links ──
export async function listIssueGitLinks(issueId: string): Promise<GitLink[]> {
  const r = await jsonFetch<{ links: GitLink[] }>(`/projects/issues/${issueId}/links`);
  return r.links ?? [];
}

// gitBranchName builds a Forgejo-friendly branch name from an issue, e.g.
// "eng-42-fix-the-thing". Pushing a branch with this name auto-links the issue.
export function gitBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug ? `${identifier.toLowerCase()}-${slug}` : identifier.toLowerCase();
}
