// TypeScript projections of the proto types in proto/grown/v1/.
// Hand-written for V1 — generation pipeline can be added later if the
// surface grows much larger.

export interface User {
  id: string;
  org_id: string;
  oidc_issuer: string;
  oidc_subject: string;
  email: string;
  display_name: string;
  // protojson serializes int64 as a string to preserve precision in JS.
  created_at: string;
  /** Present when the user has uploaded an avatar. */
  avatar_url?: string;
}

/** One entry from GET /api/v1/me/accounts — a browser-tracked signed-in account. */
export interface AccountInfo {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  avatar_url?: string;
  active: boolean;
}

export interface Org {
  id: string;
  slug: string;
  display_name: string;
  /** True for a single-user (personal) org. The SPA hides the Admin app for
   *  personal orgs. protojson omits false fields, so treat undefined as false. */
  is_personal?: boolean;
}

export interface WhoamiResponse {
  user: User;
  org: Org;
}

// Sentinel returned by client.whoami() when the user is not authenticated.
// Pattern-match on the discriminated union returned by whoami() to handle
// each case explicitly.
export type WhoamiResult =
  | { status: "ok"; data: WhoamiResponse }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

// Search types (projections of proto/grown/v1/search.proto).

export type SearchResultType =
  | "SEARCH_RESULT_TYPE_UNSPECIFIED"
  | "SEARCH_RESULT_TYPE_DRIVE"
  | "SEARCH_RESULT_TYPE_DOCS"
  | "SEARCH_RESULT_TYPE_SHEETS"
  | "SEARCH_RESULT_TYPE_SLIDES"
  | "SEARCH_RESULT_TYPE_CONTACTS"
  | "SEARCH_RESULT_TYPE_KEEP"
  | "SEARCH_RESULT_TYPE_CALENDAR"
  | "SEARCH_RESULT_TYPE_MAIL";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  snippet: string;
  url: string;
}

export interface SearchGroup {
  type: SearchResultType;
  results: SearchResult[];
}

export interface SearchResponse {
  groups: SearchGroup[];
  total_count: number;
}

/** Response from GET /api/v1/auth/demo-login when demo mode is enabled. */
export interface DemoLoginCapability {
  enabled: boolean;
  /** The email address of the pre-configured demo account. */
  username?: string;
}
