// Plugin host for the Docs scripting API (M13): a plugin is a page in a
// sandboxed iframe (allow-scripts only: an opaque origin, so it can't read
// the app's cookies, storage or DOM). It talks to the document only by
// postMessage; every call goes through callApi's method whitelist with
// plain-JSON arguments.
import { callApi, type DocApi } from "./docApi";

export interface ApiRequest {
  grownApi: 1;
  id: number | string;
  method: string;
  args?: unknown[];
}

export interface ApiReply {
  grownApi: 1;
  id: number | string;
  result?: unknown;
  error?: string;
}

export function isApiRequest(v: unknown): v is ApiRequest {
  const r = v as ApiRequest;
  return !!r && typeof r === "object" && r.grownApi === 1 && (typeof r.id === "number" || typeof r.id === "string") && typeof r.method === "string";
}

/** handleApiMessage answers one request (pure; the bridge posts it). */
export function handleApiMessage(api: DocApi, data: unknown): ApiReply | null {
  if (!isApiRequest(data)) return null;
  try {
    return { grownApi: 1, id: data.id, result: callApi(api, data.method, data.args ?? []) };
  } catch (e) {
    return { grownApi: 1, id: data.id, error: (e as Error).message };
  }
}

/** connectPlugin bridges a sandboxed iframe to the API; returns a
 *  disconnect function. Only messages from that frame are answered. */
export function connectPlugin(frame: HTMLIFrameElement, api: DocApi): () => void {
  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== frame.contentWindow) return;
    const reply = handleApiMessage(api, ev.data);
    if (reply) frame.contentWindow?.postMessage(reply, "*");
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** The client side a plugin page can paste in (documentation / example):
 *  `grown.call("AddText", ["Hello"]).then(...)`. */
export const PLUGIN_CLIENT_SNIPPET = `const grown = { n: 0, pending: new Map(),
  call(method, args = []) { const id = ++this.n; parent.postMessage({ grownApi: 1, id, method, args }, "*");
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail })); } };
addEventListener("message", (e) => { const p = grown.pending.get(e.data && e.data.id); if (!p) return;
  grown.pending.delete(e.data.id); e.data.error ? p.fail(new Error(e.data.error)) : p.ok(e.data.result); });`;
