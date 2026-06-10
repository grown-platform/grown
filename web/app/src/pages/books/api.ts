import type {
  Book,
  Bookmark,
  BookProgress,
  CreateBookInput,
  Highlight,
  HighlightColor,
  ListBooksResponse,
  ProgressInput,
  Shelf,
  UpdateBookInput,
} from "./types";

const API_BASE = "/api/v1";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

export async function listBooks(shelfId?: string): Promise<Book[]> {
  const path = shelfId
    ? `/books?shelf_id=${encodeURIComponent(shelfId)}`
    : "/books";
  const r = await jsonFetch<ListBooksResponse>(path);
  return r.books ?? [];
}

export function getBook(id: string): Promise<Book> {
  return jsonFetch<Book>(`/books/${id}`);
}

export function createBook(input: CreateBookInput): Promise<Book> {
  return jsonFetch<Book>("/books", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateBook(id: string, input: UpdateBookInput): Promise<Book> {
  return jsonFetch<Book>(`/books/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateProgress(
  id: string,
  input: ProgressInput,
): Promise<Book> {
  return jsonFetch<Book>(`/books/${id}/progress`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteBook(id: string): Promise<void> {
  await jsonFetch<unknown>(`/books/${id}`, { method: "DELETE" });
}

/** uploadBookFile attaches the book file bytes to an existing book row. */
export async function uploadBookFile(id: string, file: File): Promise<Book> {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(`${API_BASE}/books/${id}/file`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as Book;
}

/** uploadCover attaches a cover image to an existing book row. */
export async function uploadCover(id: string, file: File): Promise<Book> {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(`${API_BASE}/books/${id}/cover`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as Book;
}

/** fileURL returns the inline book-file URL (for iframe/pdf/text rendering). */
export function fileURL(id: string): string {
  return `${API_BASE}/books/${id}/file`;
}

/** downloadURL returns the attachment-disposition download URL. */
export function downloadURL(id: string): string {
  return `${API_BASE}/books/${id}/file?dl=1`;
}

/** coverURL returns the cover-image URL. */
export function coverURL(id: string): string {
  return `${API_BASE}/books/${id}/cover`;
}

// --- Reading progress ---

export function setProgress(
  bookId: string,
  locator: string,
  percent: number,
): Promise<BookProgress> {
  return jsonFetch<BookProgress>(`/books/${bookId}/reading-progress`, {
    method: "PUT",
    body: JSON.stringify({ book_id: bookId, locator, percent }),
  });
}

export function getProgress(bookId: string): Promise<BookProgress> {
  return jsonFetch<BookProgress>(`/books/${bookId}/reading-progress`);
}

// --- Bookmarks ---

export function addBookmark(
  bookId: string,
  locator: string,
  label: string,
): Promise<Bookmark> {
  return jsonFetch<Bookmark>(`/books/${bookId}/bookmarks`, {
    method: "POST",
    body: JSON.stringify({ book_id: bookId, locator, label }),
  });
}

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const r = await jsonFetch<{ bookmarks?: Bookmark[] }>(
    `/books/${bookId}/bookmarks`,
  );
  return r.bookmarks ?? [];
}

export async function deleteBookmark(
  bookId: string,
  id: string,
): Promise<void> {
  await jsonFetch<unknown>(`/books/${bookId}/bookmarks/${id}`, {
    method: "DELETE",
  });
}

// --- Highlights ---

export function addHighlight(
  bookId: string,
  locator: string,
  selectedText: string,
  note: string,
  color: HighlightColor,
): Promise<Highlight> {
  return jsonFetch<Highlight>(`/books/${bookId}/highlights`, {
    method: "POST",
    body: JSON.stringify({
      book_id: bookId,
      locator,
      selected_text: selectedText,
      note,
      color,
    }),
  });
}

export async function listHighlights(bookId: string): Promise<Highlight[]> {
  const r = await jsonFetch<{ highlights?: Highlight[] }>(
    `/books/${bookId}/highlights`,
  );
  return r.highlights ?? [];
}

export async function deleteHighlight(
  bookId: string,
  id: string,
): Promise<void> {
  await jsonFetch<unknown>(`/books/${bookId}/highlights/${id}`, {
    method: "DELETE",
  });
}

// --- Shelves ---

export function createShelf(name: string): Promise<Shelf> {
  return jsonFetch<Shelf>("/books/shelves", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function listShelves(): Promise<Shelf[]> {
  const r = await jsonFetch<{ shelves?: Shelf[] }>("/books/shelves");
  return r.shelves ?? [];
}

export async function deleteShelf(id: string): Promise<void> {
  await jsonFetch<unknown>(`/books/shelves/${id}`, { method: "DELETE" });
}

export async function addToShelf(
  shelfId: string,
  bookId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/books/shelves/${shelfId}/items`, {
    method: "POST",
    body: JSON.stringify({ shelf_id: shelfId, book_id: bookId }),
  });
}

export async function removeFromShelf(
  shelfId: string,
  bookId: string,
): Promise<void> {
  await jsonFetch<unknown>(`/books/shelves/${shelfId}/items/${bookId}`, {
    method: "DELETE",
  });
}
