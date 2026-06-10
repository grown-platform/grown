/** Doc mirrors grownv1.Doc (proto snake_case field names via the gateway). */
export interface Doc {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  preview_html?: string;
  is_template?: boolean;
}

export interface ListDocsResponse {
  docs: Doc[];
}
