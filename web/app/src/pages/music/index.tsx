import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { PlayerProvider } from "./player";
import { PlayerBar } from "./PlayerBar";
import { MusicLibrary } from "./MusicLibrary";
import { PlaylistView } from "./PlaylistView";

interface MusicAppProps {
  user: User;
}

/**
 * MusicApp is the Music library route boundary, lazy-loaded from App. A single
 * PlayerProvider wraps the routes so audio playback persists as the user moves
 * between the library (/music) and a playlist (/music/playlists/:id); the
 * PlayerBar is rendered once, outside the Routes, for the same reason.
 */
export default function MusicApp({ user }: MusicAppProps) {
  return (
    <PlayerProvider>
      <Routes>
        <Route path="/" element={<MusicLibrary user={user} />} />
        <Route path="/playlists/:id" element={<PlaylistView user={user} />} />
      </Routes>
      <PlayerBar />
    </PlayerProvider>
  );
}
