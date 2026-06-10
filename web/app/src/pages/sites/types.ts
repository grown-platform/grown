/** Site mirrors grownv1.Site (proto snake_case via the gateway).
 *  `content_json` is the serialized {@link SiteContent} tree. */
export interface Site {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  content_json: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListSitesResponse {
  sites: Site[];
}

/** SiteInput is the editable subset sent on update. */
export interface SiteInput {
  name: string;
  content_json: string;
  published: boolean;
}

// ---- Client-side content model (serialized into Site.content_json) ----

export type BlockType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "divider"
  | "embed";

/** Block is one content unit on a page. Field usage depends on `type`:
 *  - heading/text: `text`
 *  - image:        `url` (image src), optional `text` (alt)
 *  - button:       `text` (label), `url` (href)
 *  - embed:        `url` (iframe src)
 *  - divider:      none */
export interface Block {
  id: string;
  type: BlockType;
  text: string;
  url: string;
}

export interface Page {
  id: string;
  title: string;
  path: string;
  blocks: Block[];
}

/** SiteContent is the full page tree stored under Site.content_json. */
export interface SiteContent {
  pages: Page[];
}
