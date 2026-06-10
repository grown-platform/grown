// Domain types for the Projects (Linear-style) tracker. These mirror the
// proto JSON shapes returned by ProjectsService over grpc-gateway.

export interface Team {
  id: string;
  org_id: string;
  name: string;
  key: string;
  color: string;
  icon: string;
  issue_count: number;
  created_at: string;
}

export interface Issue {
  id: string;
  org_id: string;
  team_id: string;
  identifier: string;
  number: number;
  title: string;
  description: string;
  status: string;
  priority: number;
  assignee_id: string;
  assignee_name: string;
  label_ids: string[];
  project_id: string;
  estimate: number;
  sort_order: number;
  creator_id: string;
  created_at: string;
  updated_at: string;
  // Sub-issue support
  parent_issue_id?: string;
  sub_issue_count?: number;
  sub_issue_done_count?: number;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  state: string;
  lead_id: string;
  lead_name: string;
  target_date: string;
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: string;
  org_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
}

export interface TeamMember {
  user_id: string;
  name: string;
  email: string;
}

// Partial update body for PATCH /issues/{id}. Each field is paired with a
// *_set flag so the backend only mutates the properties actually sent.
export interface IssuePatch {
  title?: string;
  title_set?: boolean;
  description?: string;
  description_set?: boolean;
  status?: string;
  status_set?: boolean;
  priority?: number;
  priority_set?: boolean;
  assignee_id?: string;
  assignee_set?: boolean;
  label_ids?: string[];
  labels_set?: boolean;
  project_id?: string;
  project_set?: boolean;
  estimate?: number;
  estimate_set?: boolean;
  sort_order?: number;
  sort_order_set?: boolean;
  parent_issue_id?: string;
  parent_set?: boolean;
}
