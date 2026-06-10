/** MeetRoom mirrors grownv1.MeetRoom (proto snake_case via the gateway). */
export interface MeetRoom {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  created_at: string;
  /** Short meeting code, e.g. "abc-defg-hij". Present when returned by the codes surface. */
  code?: string;
}

export interface ListMeetRoomsResponse {
  rooms: MeetRoom[];
}

// ---- WebRTC signaling ----

export type SignalType =
  | "join"
  | "leave"
  | "offer"
  | "answer"
  | "candidate"
  | "presence"
  | "chat"
  | "media_state"
  | "hand_raise"
  | "roster_state";

export interface PeerInfo {
  id: string;
  name: string;
  audio_muted?: boolean;
  video_off?: boolean;
  hand_raised?: boolean;
}

export interface SignalMessage {
  type: SignalType;
  from?: string;
  to?: string;
  name?: string;
  peers?: PeerInfo[];
  /** SDP offer/answer or RTCIceCandidateInit */
  payload?: unknown;

  // Chat
  text?: string;

  // Media/hand state
  audio_muted?: boolean;
  video_off?: boolean;
  hand_raised?: boolean;
}

/** An in-call chat message displayed in the chat panel. */
export interface ChatEntry {
  id: string; // client-generated UUID for key
  fromId: string;
  fromName: string;
  text: string;
  sentAt: number; // Date.now()
}

/** A remote peer with an active RTCPeerConnection and media tracks. */
export interface RemotePeer {
  id: string;
  name: string;
  conn: RTCPeerConnection;
  stream: MediaStream | null;
  audioMuted: boolean;
  videoOff: boolean;
  handRaised: boolean;
}
