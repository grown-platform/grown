/** MailLabel is a named, colored label entity (from the mail_labels table). */
export interface MailLabelEntity {
  id: string;
  name: string;
  color: string;
}

/** MailMessage mirrors grownv1.MailMessage (proto snake_case via the gateway). */
export interface MailAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

export interface MailMessage {
  id: string;
  thread_id: string;
  folder: string;
  from_addr: string;
  from_name: string;
  to_addrs: string[];
  cc_addrs: string[];
  subject: string;
  body: string;
  snippet: string;
  is_read: boolean;
  starred: boolean;
  labels: string[];
  sent_at: string;
  attachments?: MailAttachment[];
  /** RFC3339 timestamp the message is snoozed until, or "" when not snoozed. */
  snooze_until?: string;
  /** Full label entities attached to this message (populated on get). */
  label_objects?: MailLabelEntity[];
}

export interface ListMessagesResponse {
  messages: MailMessage[];
  unread: Record<string, number>;
}

/** MailThread mirrors grownv1.MailThread — a conversation summary. */
export interface MailThread {
  thread_id: string;
  latest: MailMessage;
  message_count: number;
  any_unread: boolean;
  starred: boolean;
  labels: string[];
  participants: string[];
  label_objects?: MailLabelEntity[];
}

export interface ListThreadsResponse {
  threads: MailThread[];
  unread: Record<string, number>;
}

export interface GetThreadResponse {
  messages: MailMessage[];
}

export interface SendInput {
  to_addrs: string[];
  cc_addrs: string[];
  subject: string;
  body: string;
  draft?: boolean;
  attachment_ids?: string[];
}

export interface ModifyInput {
  is_read?: boolean;
  starred?: boolean;
  folder?: string;
  labels?: string[];
  set_labels?: boolean;
  /** When set_snooze is true, snooze_until ("" un-snoozes) replaces snooze state. */
  snooze_until?: string;
  set_snooze?: boolean;
}

/** MailRule mirrors grownv1.MailRule — a filter (criteria + actions). */
export interface MailRule {
  id: string;
  name: string;
  match_from: string;
  match_to: string;
  match_subject: string;
  act_label: string;
  act_folder: string;
  act_forward: string;
  act_mark_read: boolean;
  act_star: boolean;
}

export type RuleInput = Omit<MailRule, "id">;

/** MailFilter mirrors grownv1.MailFilter — a normalized filter (mail_filters table). */
export interface MailFilter {
  id: string;
  match_field: string; // from|to|subject|body
  match_op: string; // contains|equals
  match_value: string;
  action_type: string; // label|mark_read|archive|star
  action_value: string;
}

export type FilterInput = Omit<MailFilter, "id">;

export interface ListLabelsResponse2 {
  labels: string[];
  label_objects?: MailLabelEntity[];
}
