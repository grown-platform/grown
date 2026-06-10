/**
 * TypeScript shapes for Drive API responses. Field names mirror the proto
 * (snake_case) because the backend uses protojson with UseProtoNames=true.
 */
export interface DriveFile {
  id: string;
  org_id: string;
  owner_id: string;
  parent_id: string;
  name: string;
  mime_type: string;
  /** protojson serializes int64 as a string. */
  size_bytes: string;
  trashed: boolean;
  /** True when the calling user has starred this file. */
  starred?: boolean;
  /** Unix seconds as a string. */
  created_at: string;
  /** Unix seconds as a string. */
  updated_at: string;
}

export interface DriveShare {
  token: string;
  file_id: string;
  role: "viewer" | "commenter" | "editor";
  created_by: string;
  created_at: string;
  /** "0" means no expiry. */
  expires_at: string;
}

/** A historical version of a file's content. */
export interface DriveFileVersion {
  id: string;
  file_id: string;
  /** The internal blob key — not useful on the frontend except for download URLs. */
  blob_key: string;
  /** protojson serializes int64 as a string. */
  size_bytes: string;
  content_type: string;
  uploaded_by: string;
  /** Unix seconds as a string. */
  created_at: string;
}

/** The vendor MIME type the backend uses for folders. */
export const FOLDER_MIME = "application/vnd.grown.folder";

export function isFolder(f: DriveFile): boolean {
  return f.mime_type === FOLDER_MIME;
}
