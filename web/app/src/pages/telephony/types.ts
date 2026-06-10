/** Extension mirrors grownv1.Extension (proto snake_case via the gateway). */
export interface Extension {
  org_id: string;
  user_id: string;
  extension: string;
  created_at: string;
}

/** DirectoryEntry mirrors grownv1.DirectoryEntry. */
export interface DirectoryEntry {
  user_id: string;
  display_name: string;
  email: string;
  extension: string;
  online: boolean;
}

export interface ListDirectoryResponse {
  entries: DirectoryEntry[];
}

/** CallRecord mirrors grownv1.CallRecord. */
export interface CallRecord {
  id: string;
  org_id: string;
  caller_id: string;
  callee_id: string;
  /** "outgoing" or "incoming" relative to the requesting user. */
  direction: string;
  /** "completed" | "missed" | "rejected". */
  status: string;
  started_at: string;
  ended_at: string;
  peer_name: string;
  peer_extension: string;
}

export interface ListCallHistoryResponse {
  calls: CallRecord[];
}

// ---- WebRTC signaling ----

export type SignalType =
  | "presence"
  | "invite"
  | "accept"
  | "reject"
  | "busy"
  | "hangup"
  | "offer"
  | "answer"
  | "candidate";

export interface SignalMessage {
  type: SignalType;
  /** sender user id (stamped server-side) */
  from?: string;
  /** target user id */
  to?: string;
  /** sender display name */
  name?: string;
  /** online user ids — used in "presence" */
  online?: string[];
  /** SDP offer/answer or RTCIceCandidateInit */
  payload?: unknown;
}

/** CallState is the lifecycle of the single in-progress 1:1 call. */
export type CallState =
  | "idle"
  | "ringing-out" // we invited, waiting for accept
  | "ringing-in" // someone invited us
  | "connecting" // accepted, negotiating media
  | "connected"; // media flowing

/** ActiveCall describes the call currently shown in the in-call bar. */
export interface ActiveCall {
  peerId: string;
  peerName: string;
  peerExtension: string;
  /** "outgoing" if we initiated, "incoming" otherwise. */
  direction: "outgoing" | "incoming";
}
