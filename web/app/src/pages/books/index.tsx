import { Routes, Route, Navigate } from "react-router-dom";
import type { User } from "../../api/types";
import { Library } from "./Library";
import { Detail } from "./Detail";
import { Reader } from "./Reader";

interface BooksAppProps {
  user: User;
}

/** BooksApp routes the library grid, the book detail page, and the reader. */
export default function BooksApp({ user }: BooksAppProps) {
  return (
    <Routes>
      <Route index element={<Library user={user} />} />
      <Route path=":id" element={<Detail user={user} />} />
      <Route path=":id/read" element={<Reader />} />
      <Route path="*" element={<Navigate to="/books" replace />} />
    </Routes>
  );
}
