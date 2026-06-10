/** Group mirrors grownv1.Group (proto snake_case via the gateway). */
export interface Group {
  id: string;
  org_id: string;
  name: string;
  email: string;
  description: string;
  member_ids: string[];
  member_count: number;
  topic_count: number;
  post_count: number;
  created_at: string;
  updated_at: string;
}

/** GroupTopic mirrors grownv1.GroupTopic — a conversation thread in a group. */
export interface GroupTopic {
  id: string;
  group_id: string;
  org_id: string;
  subject: string;
  author_id: string;
  author_name: string;
  post_count: number;
  last_post_at: string;
  created_at: string;
}

/** GroupPost mirrors grownv1.GroupPost — a single message in a topic. */
export interface GroupPost {
  id: string;
  topic_id: string;
  group_id: string;
  org_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

/** GroupMember mirrors grownv1.GroupMember — an org user for the picker. */
export interface GroupMember {
  id: string;
  name: string;
  email: string;
}

/** CreateGroupInput is the editable subset sent on create. */
export interface CreateGroupInput {
  name: string;
  email: string;
  description: string;
  member_ids: string[];
}

/** UpdateGroupInput is the editable subset sent on update (incl. members). */
export interface UpdateGroupInput {
  name: string;
  email: string;
  description: string;
  member_ids: string[];
}

export interface ListGroupsResponse {
  groups: Group[];
}
export interface ListTopicsResponse {
  topics: GroupTopic[];
}
export interface ListPostsResponse {
  posts: GroupPost[];
}
export interface ListGroupMembersResponse {
  members: GroupMember[];
}
