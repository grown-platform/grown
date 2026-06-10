import type {
  Group,
  GroupTopic,
  GroupPost,
  GroupMember,
  CreateGroupInput,
  UpdateGroupInput,
  ListGroupsResponse,
  ListTopicsResponse,
  ListPostsResponse,
  ListGroupMembersResponse,
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

export async function listMembers(): Promise<GroupMember[]> {
  const r = await jsonFetch<ListGroupMembersResponse>("/groups/members");
  return r.members ?? [];
}

export async function listGroups(): Promise<Group[]> {
  const r = await jsonFetch<ListGroupsResponse>("/groups");
  return r.groups ?? [];
}

export function createGroup(input: CreateGroupInput): Promise<Group> {
  return jsonFetch<Group>("/groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getGroup(id: string): Promise<Group> {
  return jsonFetch<Group>(`/groups/${id}`);
}

export function updateGroup(
  id: string,
  input: UpdateGroupInput,
): Promise<Group> {
  return jsonFetch<Group>(`/groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await jsonFetch<unknown>(`/groups/${id}`, { method: "DELETE" });
}

export async function listTopics(groupId: string): Promise<GroupTopic[]> {
  const r = await jsonFetch<ListTopicsResponse>(`/groups/${groupId}/topics`);
  return r.topics ?? [];
}

export function createTopic(
  groupId: string,
  subject: string,
  body: string,
): Promise<GroupTopic> {
  return jsonFetch<GroupTopic>(`/groups/${groupId}/topics`, {
    method: "POST",
    body: JSON.stringify({ subject, body }),
  });
}

export async function listPosts(topicId: string): Promise<GroupPost[]> {
  const r = await jsonFetch<ListPostsResponse>(
    `/groups/topics/${topicId}/posts`,
  );
  return r.posts ?? [];
}

export function createPost(topicId: string, body: string): Promise<GroupPost> {
  return jsonFetch<GroupPost>(`/groups/topics/${topicId}/posts`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
