import type {
  ChatAttachment,
  ChatChannel,
  ChatMessage,
  ChatReaction,
  ListChannelsResponse,
  ListMessagesResponse,
  ReactResponse,
  CreateChannelInput,
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

export function listChannels(): Promise<ListChannelsResponse> {
  return jsonFetch<ListChannelsResponse>("/chat/channels");
}

export function createChannel(input: CreateChannelInput): Promise<ChatChannel> {
  return jsonFetch<ChatChannel>("/chat/channels", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getChannel(id: string): Promise<ChatChannel> {
  return jsonFetch<ChatChannel>(`/chat/channels/${id}`);
}

export function listMessages(
  channelId: string,
  beforeId?: string,
): Promise<ListMessagesResponse> {
  const q = new URLSearchParams();
  if (beforeId) q.set("before_id", beforeId);
  return jsonFetch<ListMessagesResponse>(
    `/chat/channels/${channelId}/messages?${q.toString()}`,
  );
}

export function postMessage(
  channelId: string,
  body: string,
  attachmentIds?: string[],
  clientNonce?: string,
): Promise<ChatMessage> {
  return jsonFetch<ChatMessage>(`/chat/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      channel_id: channelId,
      body,
      attachment_ids: attachmentIds ?? [],
      client_nonce: clientNonce ?? "",
    }),
  });
}

/** Upload one or more files as chat attachments. Returns the attachment metadata. */
export async function uploadAttachments(
  files: File[],
): Promise<ChatAttachment[]> {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const resp = await fetch("/api/v1/chat/attachments/upload", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (!resp.ok) throw new Error(`Upload failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as { attachments: ChatAttachment[] };
  return data.attachments ?? [];
}

export async function deleteMessage(
  channelId: string,
  id: string,
): Promise<void> {
  await jsonFetch<unknown>(`/chat/channels/${channelId}/messages/${id}`, {
    method: "DELETE",
  });
}

/** Toggle an emoji reaction on a message. Returns updated reaction_details. */
export function reactToMessage(
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<ReactResponse> {
  return jsonFetch<ReactResponse>(
    `/chat/channels/${channelId}/messages/${messageId}/react`,
    {
      method: "POST",
      body: JSON.stringify({
        channel_id: channelId,
        message_id: messageId,
        emoji,
      }),
    },
  );
}

/** Post a reply in a message thread. */
export function postThreadReply(
  channelId: string,
  parentId: string,
  body: string,
  attachmentIds?: string[],
): Promise<ChatMessage> {
  return jsonFetch<ChatMessage>(
    `/chat/channels/${channelId}/messages/${parentId}/replies`,
    {
      method: "POST",
      body: JSON.stringify({
        channel_id: channelId,
        parent_id: parentId,
        body,
        attachment_ids: attachmentIds ?? [],
      }),
    },
  );
}

/** List all replies in a message thread. */
export function listThreadReplies(
  channelId: string,
  parentId: string,
): Promise<ListMessagesResponse> {
  return jsonFetch<ListMessagesResponse>(
    `/chat/channels/${channelId}/messages/${parentId}/replies`,
  );
}

// Re-export ChatReaction for convenience.
export type { ChatReaction };
