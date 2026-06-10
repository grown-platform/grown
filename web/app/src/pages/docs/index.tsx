import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { DocList } from "./DocList";
import { DocEditor } from "./DocEditor";

interface DocsAppProps {
  user: User;
}

/**
 * DocsApp is the Docs route boundary. It is lazy-loaded from App so the editor
 * bundle (TipTap + Yjs) is a separate chunk that ships only when Docs is opened
 * — mirroring how Google's docs client is a distinct bundle from the shell.
 */
export default function DocsApp({ user }: DocsAppProps) {
  return (
    <Routes>
      <Route path="/" element={<DocList user={user} />} />
      <Route path="/d/:id" element={<DocEditor user={user} />} />
    </Routes>
  );
}
