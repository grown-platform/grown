import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import { SheetList } from "./SheetList";
import { SheetEditor } from "./SheetEditor";

interface SheetsAppProps {
  user: User;
}

/** SheetsApp is the Sheets route boundary, lazy-loaded so FortuneSheet ships as
 *  its own chunk only when Sheets is opened. */
export default function SheetsApp({ user }: SheetsAppProps) {
  return (
    <Routes>
      <Route path="/" element={<SheetList user={user} />} />
      <Route path="/d/:id" element={<SheetEditor user={user} />} />
    </Routes>
  );
}
