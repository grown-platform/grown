/** ChecklistItem mirrors grownv1.KeepChecklistItem. */
export interface ChecklistItem {
  text: string;
  checked: boolean;
}

/** Note mirrors grownv1.KeepNote (proto snake_case via the gateway). */
export interface Note {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  archived: boolean;
  labels: string[];
  checklist: ChecklistItem[];
  created_at: string;
  updated_at: string;
  /** remind_at is an RFC3339 timestamp; empty string = no reminder. */
  remind_at: string;
}

export interface ListNotesResponse {
  notes: Note[];
}

export interface ListRemindersResponse {
  notes: Note[];
}

export interface ListSharedWithMeResponse {
  notes: Note[];
}

export interface ListGrantsResponse {
  grants: import("../../api/directory").ObjectGrant[];
}

export interface GrantResponse {
  grant?: import("../../api/directory").ObjectGrant;
}

/** NoteInput is the editable subset sent on create/update. */
export interface NoteInput {
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  archived: boolean;
  labels: string[];
  checklist: ChecklistItem[];
}

/** KeepLabel mirrors grownv1.KeepLabel (a managed label entity). */
export interface KeepLabel {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface ListLabelsResponse {
  labels: KeepLabel[];
}
