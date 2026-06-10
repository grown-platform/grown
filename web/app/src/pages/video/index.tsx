import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { VideoLibrary } from "./VideoLibrary";
import { VideoPlayer } from "./VideoPlayer";
import { PlaylistDetail } from "./PlaylistDetail";

interface VideoAppProps {
  user: User;
}

/**
 * VideoApp is the Video library route boundary, lazy-loaded from App. The grid
 * lives at /video, the player at /video/v/:id, and playlist detail at /video/playlist/:id.
 */
export default function VideoApp({ user }: VideoAppProps) {
  return (
    <Routes>
      <Route path="/" element={<VideoLibrary user={user} />} />
      <Route path="/v/:id" element={<VideoPlayer user={user} />} />
      <Route path="/playlist/:id" element={<PlaylistDetail user={user} />} />
    </Routes>
  );
}
