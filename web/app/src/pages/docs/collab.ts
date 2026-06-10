import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { collabBase } from "./api";

export interface Collab {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  destroy: () => void;
}

// A stable per-user color for collaboration cursors, derived from the user id.
const CURSOR_COLORS = [
  "#3D5A80",
  "#E0777D",
  "#5B9279",
  "#C46B45",
  "#7A5980",
  "#2A9D8F",
  "#D9A441",
  "#B8627D",
  "#4F5D75",
  "#1D8348",
];

export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

/**
 * createCollab opens a Yjs document synced to the backend collab hub over a
 * WebSocket. The room name is "<id>/connect" so the y-websocket provider builds
 * the URL /api/v1/docs/d/<id>/connect that the Go hub serves. When a share
 * token is given it is sent as a query param so anonymous recipients authorize.
 */
export function createCollab(docId: string, token?: string): Collab {
  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(
    collabBase(),
    `${docId}/connect`,
    ydoc,
    token ? { params: { token } } : undefined,
  );
  const destroy = () => {
    provider.destroy();
    ydoc.destroy();
  };
  return { ydoc, provider, destroy };
}
