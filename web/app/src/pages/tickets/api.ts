// Same-origin fetch helpers for the Tickets app. Mirrors the pattern used in
// settings/ApiTokensSection: window.fetch with credentials:"same-origin", JSON
// bodies, and text() error bodies surfaced as Error messages.

export type IntakeMode = "team" | "public";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Source = "web" | "public";

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  intake_mode: IntakeMode;
  statuses: string[];
  open_count: number;
  created_at: number;
  public_token?: string;
  public_url?: string;
}

export interface Ticket {
  id: string;
  project_id: string;
  ref: string;
  number: number;
  title: string;
  body: string;
  status: string;
  priority: Priority;
  requester_name: string;
  requester_email: string;
  source: Source;
  created_at: number;
  updated_at: number;
  requester_user_id?: string;
  assignee_user_id?: string;
}

export interface Comment {
  id: string;
  author_name: string;
  body: string;
  is_internal: boolean;
  created_at: number;
  author_user_id?: string;
}

export interface PublicProject {
  name: string;
  description: string;
  key: string;
}

const BASE = "/api/v1/tickets";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...(init?.headers || {}) }
      : init?.headers,
  });
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const listProjects = () =>
  jfetch<{ projects: Project[] }>(`${BASE}/projects`).then((d) => d.projects ?? []);

export const createProject = (body: {
  key: string;
  name: string;
  description: string;
  intake_mode: IntakeMode;
}) =>
  jfetch<{ project: Project }>(`${BASE}/projects`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then((d) => d.project);

export const getProject = (id: string) =>
  jfetch<{ project: Project }>(`${BASE}/projects/${id}`).then((d) => d.project);

export const listTickets = (projectId: string, status?: string) => {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return jfetch<{ tickets: Ticket[] }>(
    `${BASE}/projects/${projectId}/tickets${q}`,
  ).then((d) => d.tickets ?? []);
};

export const createTicket = (
  projectId: string,
  body: { title: string; body: string; priority: Priority },
) =>
  jfetch<{ ticket: Ticket }>(`${BASE}/projects/${projectId}/tickets`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then((d) => d.ticket);

export const getTicket = (id: string) =>
  jfetch<{ ticket: Ticket; comments: Comment[] }>(`${BASE}/items/${id}`);

export const patchTicket = (
  id: string,
  body: {
    status?: string;
    priority?: Priority;
    title?: string;
    body?: string;
    assignee_user_id?: string;
    clear_assignee?: boolean;
  },
) =>
  jfetch<{ ticket: Ticket }>(`${BASE}/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((d) => d.ticket);

export const addComment = (
  id: string,
  body: { body: string; is_internal: boolean },
) =>
  jfetch<{ comment: Comment }>(`${BASE}/items/${id}/comments`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then((d) => d.comment);

// Public (no auth) intake endpoints.
export const getPublicProject = (token: string) =>
  jfetch<PublicProject>(`/api/v1/public/tickets/${token}`);

export const submitPublicTicket = (
  token: string,
  body: { title: string; body: string; name: string; email: string },
) =>
  jfetch<{ ref: string; message: string }>(`/api/v1/public/tickets/${token}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
