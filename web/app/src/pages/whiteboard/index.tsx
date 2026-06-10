import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { WhiteboardList } from "./WhiteboardList";
import { WhiteboardEditor } from "./WhiteboardEditor";

interface WhiteboardAppProps {
  user: User;
}

/** WhiteboardApp is the Whiteboard route boundary, lazy-loaded so Excalidraw
 *  ships as its own chunk only when a board is opened. */
export default function WhiteboardApp({ user }: WhiteboardAppProps) {
  return (
    <Routes>
      <Route path="/" element={<WhiteboardList user={user} />} />
      <Route path="/d/:id" element={<WhiteboardEditor user={user} />} />
    </Routes>
  );
}
