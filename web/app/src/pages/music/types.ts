/** Track mirrors grownv1.Track (proto snake_case via the gateway). */
export interface Track {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  artist: string;
  album: string;
  content_type: string;
  size: number;
  duration_seconds: number;
  artwork_data_url: string;
  stream_url: string;
  created_at: string;
  updated_at: string;
  /** liked is true when the calling user has liked this track. */
  liked?: boolean;
}

/** Playlist mirrors grownv1.Playlist. List responses omit `tracks` and carry
 *  only `track_count`; detail/mutation responses populate `tracks`. */
export interface Playlist {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  description: string;
  tracks: Track[];
  track_count: number;
  created_at: string;
  updated_at: string;
}

export interface ListTracksResponse {
  tracks: Track[];
}

export interface ListPlaylistsResponse {
  playlists: Playlist[];
}

/** TrackUpdateInput is the editable metadata sent on update. */
export interface TrackUpdateInput {
  title: string;
  artist: string;
  album: string;
  artwork_data_url: string;
}

/** PlaylistInput is the editable metadata sent on create/update. */
export interface PlaylistInput {
  name: string;
  description: string;
}
