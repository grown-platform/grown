/** item_type values matching the backend constants. */
export type ItemType = "event" | "task" | "out_of_office" | "focus_time";

/** CalendarEvent mirrors grownv1.Event (proto snake_case via the gateway). */
export interface CalendarEvent {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  description: string;
  location: string;
  start_at: string; // RFC3339
  end_at: string; // RFC3339
  all_day: boolean;
  color: string;
  recurrence: string;
  attendees?: string[];
  /** Set on expanded recurring instances; equals the master event's id. */
  recurring_event_id?: string;
  /** RFC3339 of the original computed start for this occurrence (exception overrides). */
  original_start?: string;
  /** Set when this row is an exception override for a specific occurrence. */
  recurrence_parent_id?: string;
  created_at: string;
  updated_at: string;
  /** item_type: "event" | "task" | "out_of_office" | "focus_time" */
  item_type?: ItemType;
  /** reminders: minutes-before-start list. */
  reminders?: number[];
  /** status: "busy" | "free" */
  status?: string;
  /** visibility: "default" | "public" | "private" */
  visibility?: string;
  /** task_done: completion flag (tasks only). */
  task_done?: boolean;
}

export interface ListEventsResponse {
  events: CalendarEvent[];
}

/** EventInput is the editable subset sent on create/update. */
export interface EventInput {
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  color: string;
  recurrence: string;
  attendees: string[];
  item_type: ItemType;
  reminders: number[];
  status: string;
  visibility: string;
  task_done: boolean;
  /** Edit scope for recurring events: 1=THIS_EVENT, 2=ALL_EVENTS (default). */
  scope?: number;
  /** Required when scope=THIS_EVENT: the RFC3339 start of the target occurrence. */
  original_start?: string;
}

/** Attendee mirrors grownv1.Attendee. */
export interface Attendee {
  event_id: string;
  email: string;
  response_status: string; // needs_action | accepted | declined | tentative
  optional: boolean;
  created_at: string;
}

export interface ListAttendeesResponse {
  attendees: Attendee[];
}
