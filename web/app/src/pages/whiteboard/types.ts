/** Whiteboard mirrors grownv1.Whiteboard (proto snake_case via the gateway). */
export interface Whiteboard {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Scene JSON (Excalidraw model); only present from GetWhiteboard. */
  data?: string;
}

export interface ListWhiteboardsResponse {
  whiteboards: Whiteboard[];
}

export interface ListWhiteboardsSharedWithMeResponse {
  whiteboards: Whiteboard[];
}
