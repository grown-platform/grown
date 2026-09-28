import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Container, Input, Button } from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1";
import { Header } from "../components/Header";
import { TileGrid } from "../components/TileGrid";
import { apps } from "../catalog/apps";
import {
  applyServiceSettings,
  useServiceSettings,
} from "../catalog/serviceSettings";
import type { User } from "../api/types";
import { adminWhoAmI } from "./admin/usersApi";
import { AddUserDialog } from "./admin/AddUserDialog";

interface DashboardProps {
  user: User;
}

export function Dashboard({ user }: DashboardProps) {
  // Per-org service settings (Admin app): disabled services are hidden
  // ("admin" itself never is, so it can be re-enabled), a non-empty
  // external_url sends the tile to that URL, and bring-your-own tiles (Home
  // Assistant) only appear once they have a URL. Fail-open for built-ins: a
  // fetch error shows all built-in tiles.
  const settings = useServiceSettings();
  const [query, setQuery] = useState("");
  // Admin-only "Add user" affordance: only shown when the caller is an admin AND
  // user management is actually wired (Zitadel service token present).
  const [canAddUser, setCanAddUser] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  // In a single-user (personal) org the Admin app is hidden entirely; admins of a
  // team org see it (gated by !isPersonal && isAdmin).
  const [showAdmin, setShowAdmin] = useState(false);
  // Focus the search on load so you can start typing apps immediately — desktop
  // only (auto-focusing on touch devices pops the soft keyboard, which is worse).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
      searchRef.current?.focus();
    }
  }, []);
  useEffect(() => {
    let alive = true;
    adminWhoAmI()
      .then((w) => {
        if (!alive) return;
        setCanAddUser(w.isAdmin && w.userMgmtEnabled && !w.isPersonal);
        // Show the Admin tile to any team-org member (not just admins) so the
        // demo can browse the admin area + submenus. The backend still gates
        // every admin endpoint, so non-admins see the UI shell with no data.
        setShowAdmin(!w.isPersonal);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const visibleApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applyServiceSettings(apps, settings ?? null).filter((a) => {
      // The Admin tile is only shown to team-org members (hidden in personal orgs).
      if (a.id === "admin" && !showAdmin) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) || a.blurb.toLowerCase().includes(q)
      );
    });
  }, [settings, query, showAdmin]);

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {canAddUser && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
            <Button
              size="sm"
              variant="outlined"
              startDecorator={<PersonAddIcon />}
              onClick={() => setAddUserOpen(true)}
              data-testid="dashboard-add-user"
            >
              Add user
            </Button>
          </Box>
        )}
        <Box sx={{ display: "flex", justifyContent: "center", mb: 3 }}>
          <Input
            startDecorator={<SearchIcon />}
            placeholder="Search apps…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: "100%", maxWidth: 420, "--Input-radius": "999px" }}
          />
        </Box>
        <TileGrid apps={visibleApps} />
      </Container>
      {addUserOpen && <AddUserDialog onClose={() => setAddUserOpen(false)} />}
    </>
  );
}
