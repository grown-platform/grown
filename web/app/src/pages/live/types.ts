// TypeScript projection of grown.v1 LiveStream (proto/grown/v1/live.proto).
// Hand-written to match the protojson (snake_case) wire form, like the other
// grown apps' types.ts.

export interface LiveStream {
  id: string;
  org_id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  description: string;
  /** "org" | "public" */
  visibility: string;
  /** "offline" | "live" */
  status: string;
  /** MediaMTX path; basis of the ingest/playback URLs. */
  path: string;
  /** Secret publish key — only populated for the owner. */
  stream_key?: string;
  /** RTMP publish URL for OBS/streaming software (owner only). */
  ingest_rtmp_url?: string;
  /** WebRTC/WHIP publish endpoint for browser Go Live (owner only). */
  ingest_whip_url?: string;
  /** HLS playlist for playback (always present). */
  hls_url: string;
  /** WebRTC/WHEP read endpoint for low-latency playback (always present). */
  whep_url: string;
  started_at?: string;
  ended_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ListStreamsResponse {
  streams: LiveStream[];
}

export type StreamFilter = "live" | "mine" | "all";

export interface CreateStreamInput {
  title: string;
  description?: string;
  visibility?: "org" | "public";
}

export interface UpdateStreamInput {
  title?: string;
  description?: string;
  visibility?: "org" | "public";
}
