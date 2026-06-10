import { useState, useCallback } from "react";
import {
  deleteTrack,
  updateTrack,
  downloadUrl,
  listPlaylists,
  addTrackToPlaylist,
  createPlaylist,
  likeTrack,
  unlikeTrack,
} from "./api";
import type { Track, Playlist } from "./types";
import { usePlayer } from "./player";
import {
  TrackEditDialog,
  AddToPlaylistDialog,
  PlaylistFormDialog,
} from "./dialogs";

interface UseTrackActionsOpts {
  /** Optimistically apply an edit to the caller's local track list. */
  onTrackUpdated?: (track: Track) => void;
  /** Notify the caller a track was deleted so it can drop it from its list. */
  onTrackDeleted?: (trackId: string) => void;
  /** Optimistically toggle liked status on a track. */
  onTrackLikeToggled?: (trackId: string, liked: boolean) => void;
}

/** useTrackActions bundles the cross-cutting per-track actions (edit, delete,
 *  download, add-to-playlist, like, queue management) and the dialogs they
 *  open, so both the library and playlist views share one implementation.
 *  Render `dialogs` somewhere in the tree and wire the returned callbacks into
 *  TrackRow. */
export function useTrackActions({
  onTrackUpdated,
  onTrackDeleted,
  onTrackLikeToggled,
}: UseTrackActionsOpts = {}) {
  const player = usePlayer();
  const [editing, setEditing] = useState<Track | null>(null);
  const [adding, setAdding] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [creatingFor, setCreatingFor] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback((t: Track) => {
    window.open(downloadUrl(t.id), "_blank");
  }, []);

  const toggleLike = useCallback(
    async (t: Track) => {
      const nowLiked = !t.liked;
      // Optimistic update.
      onTrackLikeToggled?.(t.id, nowLiked);
      try {
        if (nowLiked) await likeTrack(t.id);
        else await unlikeTrack(t.id);
      } catch (e) {
        // Revert on failure.
        onTrackLikeToggled?.(t.id, !nowLiked);
        setError((e as Error).message);
      }
    },
    [onTrackLikeToggled],
  );

  const remove = useCallback(
    async (t: Track) => {
      if (
        !window.confirm(
          `Delete "${t.title || "this track"}"? This can't be undone.`,
        )
      )
        return;
      player.removeFromQueue(t.id);
      onTrackDeleted?.(t.id);
      try {
        await deleteTrack(t.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [player, onTrackDeleted],
  );

  const beginAddToPlaylist = useCallback(async (t: Track) => {
    setAdding(t);
    setPlaylists(null);
    try {
      setPlaylists(await listPlaylists());
    } catch (e) {
      setError((e as Error).message);
      setPlaylists([]);
    }
  }, []);

  const saveEdit = useCallback(
    async (input: { title: string; artist: string; album: string }) => {
      if (!editing) return;
      const id = editing.id;
      setEditing(null);
      onTrackUpdated?.({ ...editing, ...input });
      try {
        await updateTrack(id, input);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [editing, onTrackUpdated],
  );

  const addToExisting = useCallback(
    async (playlistId: string) => {
      if (!adding) return;
      const t = adding;
      setAdding(null);
      try {
        await addTrackToPlaylist(playlistId, t.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [adding],
  );

  const createAndAdd = useCallback(
    async (input: { name: string; description: string }) => {
      const t = creatingFor;
      setCreatingFor(null);
      try {
        const pl = await createPlaylist(input);
        if (t) await addTrackToPlaylist(pl.id, t.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [creatingFor],
  );

  const dialogs = (
    <>
      {editing && (
        <TrackEditDialog
          track={editing}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
      {adding && (
        <AddToPlaylistDialog
          trackTitle={adding.title || "Untitled track"}
          playlists={playlists}
          onAdd={addToExisting}
          onCreateNew={() => {
            setCreatingFor(adding);
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}
      {creatingFor && (
        <PlaylistFormDialog
          onClose={() => setCreatingFor(null)}
          onSave={createAndAdd}
        />
      )}
    </>
  );

  return {
    dialogs,
    error,
    clearError: () => setError(null),
    actions: {
      play: (t: Track) => player.playTrack(t),
      playNext: (t: Track) => player.playNext(t),
      addToQueue: (t: Track) => player.addToQueue(t),
      edit: (t: Track) => setEditing(t),
      remove,
      download,
      toggleLike,
      addToPlaylist: beginAddToPlaylist,
    },
  };
}
