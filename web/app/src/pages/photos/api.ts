import type {
  Photo,
  Album,
  ListPhotosResponse,
  ListAlbumsResponse,
  UpdatePhotoInput,
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

// --- photos ---
export async function listPhotos(opts?: {
  albumId?: string;
  favorites?: boolean;
}): Promise<Photo[]> {
  const q = new URLSearchParams();
  if (opts?.albumId) q.set("album_id", opts.albumId);
  if (opts?.favorites) q.set("favorites", "true");
  const qs = q.toString();
  const r = await jsonFetch<ListPhotosResponse>(`/photos${qs ? `?${qs}` : ""}`);
  return r.photos ?? [];
}

export function getPhoto(id: string): Promise<Photo> {
  return jsonFetch<Photo>(`/photos/${id}`);
}

export function updatePhoto(
  id: string,
  input: UpdatePhotoInput,
): Promise<Photo> {
  return jsonFetch<Photo>(`/photos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deletePhoto(id: string): Promise<void> {
  await jsonFetch<unknown>(`/photos/${id}`, { method: "DELETE" });
}

// --- albums ---
export async function listAlbums(): Promise<Album[]> {
  const r = await jsonFetch<ListAlbumsResponse>("/photos/albums");
  return r.albums ?? [];
}

export function getAlbum(id: string): Promise<Album> {
  return jsonFetch<Album>(`/photos/albums/${id}`);
}

export function createAlbum(
  title: string,
  photoIds?: string[],
): Promise<Album> {
  return jsonFetch<Album>("/photos/albums", {
    method: "POST",
    body: JSON.stringify({ title, photo_ids: photoIds ?? [] }),
  });
}

export function updateAlbum(
  id: string,
  input: { title?: string; cover_photo_id?: string },
): Promise<Album> {
  return jsonFetch<Album>(`/photos/albums/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteAlbum(id: string): Promise<void> {
  await jsonFetch<unknown>(`/photos/albums/${id}`, { method: "DELETE" });
}

export function addToAlbum(
  albumId: string,
  photoIds: string[],
): Promise<Album> {
  return jsonFetch<Album>(`/photos/albums/${albumId}/photos`, {
    method: "POST",
    body: JSON.stringify({ photo_ids: photoIds }),
  });
}

export function removeFromAlbum(
  albumId: string,
  photoId: string,
): Promise<Album> {
  return jsonFetch<Album>(`/photos/albums/${albumId}/photos/${photoId}`, {
    method: "DELETE",
  });
}

// --- upload / image bytes ---
export async function uploadPhotos(files: FileList | File[]): Promise<Photo[]> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("file", f);
  const resp = await fetch(`${API_BASE}/photos/upload`, {
    method: "POST",
    credentials: "same-origin",
    body: fd,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const r = (await resp.json()) as { photos: Photo[] };
  return r.photos ?? [];
}

/** photoURL returns the inline image URL for a photo. */
export function photoURL(id: string): string {
  return `${API_BASE}/photos/${id}/content`;
}

/** downloadURL returns the URL that forces an attachment download. */
export function downloadURL(id: string): string {
  return `${API_BASE}/photos/${id}/content?download=1`;
}
