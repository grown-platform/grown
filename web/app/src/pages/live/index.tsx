import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { LiveBrowse } from "./LiveBrowse";
import GoLive from "./GoLive";
import WatchStream from "./WatchStream";

interface LiveAppProps {
  user: User;
}

/**
 * LiveApp is the Live route boundary, lazy-loaded from App. Browse lives at
 * /live, Go Live at /live/new, and the (authenticated) watch page at
 * /live/watch/:id. The PUBLIC watch route (/live/p/:id, viewable signed-out)
 * is mounted separately in App.tsx ahead of the auth gate.
 */
export default function LiveApp({ user }: LiveAppProps) {
  return (
    <Routes>
      <Route path="/" element={<LiveBrowse user={user} />} />
      <Route path="/new" element={<GoLive user={user} />} />
      <Route path="/watch/:id" element={<WatchStream user={user} />} />
    </Routes>
  );
}
