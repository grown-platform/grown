/** Book mirrors grownv1.Book (proto snake_case via the gateway). */
export interface Book {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  author: string;
  /** one of: epub, pdf, mobi, txt, cbz */
  format: BookFormat;
  description: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  has_cover: boolean;
  starred: boolean;
  finished: boolean;
  last_location: string;
  progress_percent: number;
  created_at: string;
  updated_at: string;
}

/** BookProgress mirrors grownv1.BookProgress. */
export interface BookProgress {
  user_id: string;
  book_id: string;
  locator: string;
  percent: number;
  updated_at: string;
}

/** Bookmark mirrors grownv1.Bookmark. */
export interface Bookmark {
  id: string;
  org_id: string;
  user_id: string;
  book_id: string;
  locator: string;
  label: string;
  created_at: string;
}

/** Highlight mirrors grownv1.Highlight. */
export interface Highlight {
  id: string;
  org_id: string;
  user_id: string;
  book_id: string;
  locator: string;
  selected_text: string;
  note: string;
  /** one of: yellow, green, blue, pink */
  color: HighlightColor;
  created_at: string;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
];

export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#FFF176",
  green: "#C8E6C9",
  blue: "#B3E5FC",
  pink: "#F8BBD0",
};

/** Shelf mirrors grownv1.Shelf. */
export interface Shelf {
  id: string;
  org_id: string;
  owner_user_id: string;
  name: string;
  created_at: string;
}

export type BookFormat = "epub" | "pdf" | "mobi" | "txt" | "cbz";

export const SUPPORTED_FORMATS: BookFormat[] = [
  "epub",
  "pdf",
  "mobi",
  "txt",
  "cbz",
];

/** Formats the in-browser reader can render. Others are download-only. */
export const READABLE_FORMATS: BookFormat[] = ["pdf", "txt", "epub", "cbz"];

export interface ListBooksResponse {
  books: Book[];
}

/** CreateBookInput is the editable subset sent on create. */
export interface CreateBookInput {
  title: string;
  author: string;
  format: BookFormat;
  description: string;
}

export interface UpdateBookInput {
  title: string;
  author: string;
  description: string;
  starred: boolean;
}

export interface ProgressInput {
  last_location: string;
  progress_percent: number;
  finished: boolean;
}

/** extToFormat maps a filename extension to a supported book format. */
export function extToFormat(filename: string): BookFormat | null {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return null;
  const ext = m[1];
  if ((SUPPORTED_FORMATS as string[]).includes(ext)) return ext as BookFormat;
  return null;
}

export function formatLabel(f: BookFormat): string {
  return f.toUpperCase();
}
