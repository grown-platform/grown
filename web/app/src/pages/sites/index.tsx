import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import SiteList from "./SiteList";
import SiteEditor from "./SiteEditor";

interface SitesAppProps {
  user: User;
}

/** SitesApp owns the authenticated /sites/* routes:
 *  - /sites           → site list (cards)
 *  - /sites/edit/:id  → editor
 *  The public /sites/view/:siteId route is mounted separately in App.tsx
 *  (no account required). */
export default function SitesApp({ user }: SitesAppProps) {
  return (
    <Routes>
      <Route path="/" element={<SiteList user={user} />} />
      <Route path="/edit/:id" element={<SiteEditor user={user} />} />
    </Routes>
  );
}
