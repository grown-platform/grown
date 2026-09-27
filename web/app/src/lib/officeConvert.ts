// Optional server-side LibreOffice conversion (CC8). When the server runs
// with GROWN_LIBREOFFICE=1, legacy .doc/.xls/.ppt (and .wpd, .dot, .xlt,
// .pps, .pot) are converted to docx/xlsx/pptx on the server and then read by
// the existing in-browser importers, so Docs/Sheets/Slides fidelity work is
// reused. With GROWN_LIBREOFFICE_ODF=1 the server also asks clients to send
// odt/ods/odp/rtf through LibreOffice ("preferred"); otherwise those keep
// using Grown's own readers.
//
// Everything here degrades to "not available" when the endpoint is missing
// or disabled, so the pickers only offer legacy formats when they work.

import { useEffect, useState } from "react";

export type OfficeTarget = "docx" | "xlsx" | "pptx";

export interface OfficeConvertCaps {
  enabled: boolean;
  /** source extension → target, for every format the server accepts */
  formats: Record<string, OfficeTarget>;
  /** extensions only LibreOffice can read */
  legacy: string[];
  /** extensions the server wants routed through LibreOffice for fidelity */
  preferred: string[];
  maxBytes: number;
}

export const OFFICE_CONVERT_DISABLED: OfficeConvertCaps = {
  enabled: false,
  formats: {},
  legacy: [],
  preferred: [],
  maxBytes: 0,
};

/** Which app each target opens in. */
export const TARGET_APP: Record<OfficeTarget, "docs" | "sheets" | "slides"> = {
  docx: "docs",
  xlsx: "sheets",
  pptx: "slides",
};

let capsPromise: Promise<OfficeConvertCaps> | null = null;

/** Parse the capabilities JSON defensively. */
export function parseCaps(j: unknown): OfficeConvertCaps {
  if (!j || typeof j !== "object" || !(j as { enabled?: unknown }).enabled) return OFFICE_CONVERT_DISABLED;
  const o = j as Record<string, unknown>;
  const formats: Record<string, OfficeTarget> = {};
  for (const [k, v] of Object.entries((o.formats as Record<string, unknown>) ?? {})) {
    if (v === "docx" || v === "xlsx" || v === "pptx") formats[k.toLowerCase()] = v;
  }
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is string => typeof e === "string" && !!formats[e]) : []);
  return {
    enabled: true,
    formats,
    legacy: list(o.legacy),
    preferred: list(o.preferred),
    maxBytes: typeof o.max_bytes === "number" ? o.max_bytes : 0,
  };
}

/** Fetch (once per page load) what the server's converter accepts. */
export function officeConvertCaps(): Promise<OfficeConvertCaps> {
  if (!capsPromise) {
    capsPromise = (async () => {
      try {
        const r = await fetch("/api/v1/convert/capabilities", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!r.ok) return OFFICE_CONVERT_DISABLED;
        return parseCaps(await r.json());
      } catch {
        return OFFICE_CONVERT_DISABLED;
      }
    })();
  }
  return capsPromise;
}

/** Test hook: forget the cached capabilities. */
export function resetOfficeConvertCaps(caps?: OfficeConvertCaps) {
  capsPromise = caps ? Promise.resolve(caps) : null;
}

/** React hook: the capabilities, or the disabled value until they load. */
export function useOfficeConvertCaps(): OfficeConvertCaps {
  const [caps, setCaps] = useState<OfficeConvertCaps>(OFFICE_CONVERT_DISABLED);
  useEffect(() => {
    let live = true;
    void officeConvertCaps().then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

export function fileExt(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Should `name` go through the server converter before the app's own
 * importer? True for legacy formats the server accepts, and for ODF/RTF only
 * when the server marks them preferred. `target` limits it to one app.
 */
export function needsServerConversion(caps: OfficeConvertCaps, name: string, target?: OfficeTarget): boolean {
  if (!caps.enabled) return false;
  const ext = fileExt(name);
  const to = caps.formats[ext];
  if (!to || (target && to !== target)) return false;
  return caps.legacy.includes(ext) || caps.preferred.includes(ext);
}

/** Extra `accept` entries (".doc,.dot,…") the server adds for one target. */
export function legacyAccept(caps: OfficeConvertCaps, target: OfficeTarget): string {
  return caps.legacy
    .filter((e) => caps.formats[e] === target)
    .map((e) => `.${e}`)
    .join(",");
}

/** Join accept lists, skipping empties and duplicates. */
export function joinAccept(...parts: string[]): string {
  const seen = new Set<string>();
  for (const p of parts) for (const e of p.split(",")) if (e.trim()) seen.add(e.trim());
  return [...seen].join(",");
}

/**
 * Convert a legacy office file on the server. Returns the OOXML package as a
 * File named after the source with the new extension, ready for the app's
 * existing importer.
 */
export async function convertOnServer(file: Blob, name: string): Promise<File> {
  const caps = await officeConvertCaps();
  const ext = fileExt(name);
  const to = caps.formats[ext];
  if (!caps.enabled || !to) throw new Error(`.${ext} files can’t be converted on this server`);
  if (caps.maxBytes && file.size > caps.maxBytes) {
    throw new Error(`File is too large to convert (max ${Math.round(caps.maxBytes / (1 << 20))} MB)`);
  }
  const base = name.replace(/\.[^.]+$/, "") || "document";
  const q = new URLSearchParams({ from: ext, to, name: base });
  const r = await fetch(`/api/v1/convert/office?${q}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!r.ok) {
    const msg = (await r.text().catch(() => "")).trim();
    throw new Error(msg || `Conversion failed (HTTP ${r.status})`);
  }
  const blob = await r.blob();
  const mime: Record<OfficeTarget, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return new File([blob], `${base}.${to}`, { type: mime[to] });
}
