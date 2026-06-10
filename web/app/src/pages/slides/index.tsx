import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { DeckList } from "./DeckList";
import { DeckEditor } from "./DeckEditor";

interface SlidesAppProps {
  user: User;
}

/** SlidesApp is the Slides route boundary, lazy-loaded so the editor (and
 *  pptxgenjs) ship as their own chunk only when Slides is opened. */
export default function SlidesApp({ user }: SlidesAppProps) {
  return (
    <Routes>
      <Route path="/" element={<DeckList user={user} />} />
      <Route path="/d/:id" element={<DeckEditor user={user} />} />
    </Routes>
  );
}
