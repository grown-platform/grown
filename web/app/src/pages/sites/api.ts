import type {
  Site,
  SiteInput,
  ListSitesResponse,
  SiteContent,
  Page,
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

export async function listSites(): Promise<Site[]> {
  const r = await jsonFetch<ListSitesResponse>("/sites");
  return r.sites ?? [];
}

export function getSite(id: string): Promise<Site> {
  return jsonFetch<Site>(`/sites/${id}`);
}

/** Public, no-auth fetch of a published site for the share/view route. */
export function getPublishedSite(id: string): Promise<Site> {
  return jsonFetch<Site>(`/sites/${id}/published`);
}

export function createSite(name: string, contentJson = ""): Promise<Site> {
  return jsonFetch<Site>("/sites", {
    method: "POST",
    body: JSON.stringify({ name, content_json: contentJson }),
  });
}

export function updateSite(id: string, input: SiteInput): Promise<Site> {
  return jsonFetch<Site>(`/sites/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteSite(id: string): Promise<void> {
  await jsonFetch<unknown>(`/sites/${id}`, { method: "DELETE" });
}

// ---- content (de)serialization ----

let counter = 0;
/** uid generates a stable-enough client id for pages and blocks. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function emptyPage(title = "Home"): Page {
  return {
    id: uid("page"),
    title,
    path: "/",
    blocks: [{ id: uid("block"), type: "heading", text: title, url: "" }],
  };
}

export function emptyContent(): SiteContent {
  return { pages: [emptyPage()] };
}

/** parseContent decodes Site.content_json, tolerating empty/blank/garbage by
 *  falling back to a single blank page so the editor never crashes. */
export function parseContent(json: string): SiteContent {
  if (!json || json.trim() === "" || json.trim() === "{}")
    return emptyContent();
  try {
    const parsed = JSON.parse(json) as Partial<SiteContent>;
    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    if (pages.length === 0) return emptyContent();
    // Normalise blocks defensively (older/foreign payloads may omit fields).
    return {
      pages: pages.map((p) => ({
        id: p.id || uid("page"),
        title: p.title ?? "",
        path: p.path || "/",
        blocks: Array.isArray(p.blocks)
          ? p.blocks.map((b) => ({
              id: b.id || uid("block"),
              type: b.type ?? "text",
              text: b.text ?? "",
              url: b.url ?? "",
            }))
          : [],
      })),
    };
  } catch {
    return emptyContent();
  }
}

export function serializeContent(content: SiteContent): string {
  return JSON.stringify(content);
}
