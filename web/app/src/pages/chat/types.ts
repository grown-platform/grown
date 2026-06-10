/** ChatChannel mirrors grownv1.ChatChannel (proto snake_case via the gateway). */
export interface ChatChannel {
  id: string;
  org_id: string;
  kind: "dm" | "group";
  name: string;
  member_ids: string[];
  created_at: string;
  updated_at: string;
  last_message_at: string;
  unread_count: number;
}

/** ChatAttachment mirrors grownv1.ChatAttachment. */
export interface ChatAttachment {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  url: string;
}

/** ChatReaction mirrors grownv1.ChatReaction. */
export interface ChatReaction {
  emoji: string;
  count: number;
  /** True when the requesting user has reacted with this emoji. */
  me: boolean;
}

/** ChatMessage mirrors grownv1.ChatMessage. */
export interface ChatMessage {
  id: string;
  channel_id: string;
  org_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  /** @deprecated Use reaction_details instead. */
  reactions: string; // JSON object {"emoji": count}
  sent_at: string;
  attachments?: ChatAttachment[];
  /** Structured reaction aggregates. */
  reaction_details?: ChatReaction[];
  /** ID of the parent message for thread replies. Empty for top-level. */
  parent_id?: string;
  /** Number of thread replies (populated for top-level messages). */
  reply_count?: number;
  /** Echoed back from PostChatMessage for optimistic-UI deduplication. */
  client_nonce?: string;
  /** Set client-side only on optimistic messages; cleared on confirmation. */
  _optimistic?: true;
}

export interface ListChannelsResponse {
  channels: ChatChannel[];
}

export interface ListMessagesResponse {
  messages: ChatMessage[];
}

export interface ReactResponse {
  reaction_details: ChatReaction[];
}

export interface CreateChannelInput {
  kind: "dm" | "group";
  name?: string;
  member_ids?: string[];
}

export interface PostMessageInput {
  channel_id: string;
  body: string;
  attachment_ids?: string[];
}

/** WS envelope sent by the server over the chat WebSocket. */
export type ChatWSEvent =
  | { type: "message"; channel_id: string; message: ChatMessage }
  | { type: "presence"; channel_id: string; online: string[] }
  | { type: "deleted"; channel_id: string; id: string };
