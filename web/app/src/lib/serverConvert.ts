// The server's pandoc conversion endpoint (/api/v1/docs/convert), shared by
// the Docs and Sheets downloads. pandoc and a PDF engine are optional on the
// server, so callers ask what it can do before relying on it.

/** What the server's pandoc endpoint can produce (GET …/convert/capabilities). */
export interface ServerConvertCapabilities {
  pandoc: boolean;
  formats: string[];
  pdf: boolean;
  pdf_engine?: string;
}

let capsPromise: Promise<ServerConvertCapabilities | null> | null = null;

/** serverConvertCapabilities asks the server once which formats it converts. */
export function serverConvertCapabilities(): Promise<ServerConvertCapabilities | null> {
  capsPromise ??= fetch("/api/v1/docs/convert/capabilities", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<ServerConvertCapabilities>) : null))
    .catch(() => null);
  return capsPromise;
}

/** postConvert sends HTML through the server's pandoc endpoint. */
export async function postConvert(html: string, fmt: string, name: string): Promise<Blob> {
  const resp = await fetch(
    `/api/v1/docs/convert?to=${fmt}&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "text/html" },
      body: html,
    },
  );
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).trim();
    throw new Error(
      `Export failed: HTTP ${resp.status}${detail ? " — " + detail.slice(0, 400) : ""}`,
    );
  }
  return resp.blob();
}
