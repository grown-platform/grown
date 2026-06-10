/** Contact mirrors grownv1.Contact (proto snake_case via the gateway). */
export interface Contact {
  id: string;
  org_id: string;
  owner_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  emails: string[];
  phones: string[];
  labels: string[];
  notes: string;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListContactsResponse {
  contacts: Contact[];
}

/** ContactInput is the editable subset sent on create/update. */
export interface ContactInput {
  display_name: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  emails: string[];
  phones: string[];
  labels: string[];
  notes: string;
  starred: boolean;
}

/** ContactGroup mirrors grownv1.ContactGroup. */
export interface ContactGroup {
  id: string;
  org_id: string;
  owner_user_id: string;
  name: string;
  created_at: string;
}

export interface ListContactGroupsResponse {
  groups: ContactGroup[];
}
