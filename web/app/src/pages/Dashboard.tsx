import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Container, Input, Button } from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1";
import { Header } from "../components/Header";
import { TileGrid } from "../components/TileGrid";
import { apps } from "../catalog/apps";
import type { User } from "../api/types";
import { adminWhoAmI } from "./admin/usersApi";
import { AddUserDialog } from "./admin/AddUserDialog";

interface DashboardProps {
  user: User;
}

export function Dashboard({ user }: DashboardProps) {
  // Org admins can disable individual services (Admin app). Hide any tile whose
  // service has been turned off; "admin" itself is never hidden so it can be
  // re-enabled. Fail-open: a fetch error shows all tiles.
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  // Per-service external URL overrides fetched from the service-settings API.
  // When set, the tile opens the external URL instead of the internal route.
  const [externalUrls, setExternalUrls] = useState<Map<string, string>>(
    new Map(),
  );
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
    fetch("/api/v1/admin/service-settings", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(
        (d: {
          settings?: {
            service_id: string;
            enabled: boolean;
            external_url?: string;
          }[];
        }) => {
          if (!alive) return;
          const settings = d.settings ?? [];
          setDisabled(
            new Set(
              settings.filter((s) => !s.enabled).map((s) => s.service_id),
            ),
          );
          setExternalUrls(
            new Map(
              settings
                .filter((s) => s.external_url)
                .map((s) => [s.service_id, s.external_url!]),
            ),
          );
        },
      )
      .catch(() => {});
    adminWhoAmI()
      .then((w) => {
        if (!alive) return;
        setCanAddUser(w.isAdmin && w.userMgmtEnabled && !w.isPersonal);
        setShowAdmin(w.isAdmin && !w.isPersonal);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const visibleApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps
      .filter((a) => {
        // The Admin tile is only shown to team-org admins (hidden in personal orgs);
        // other tiles hide when their service is disabled.
        if (a.id === "admin") {
          if (!showAdmin) return false;
        } else if (disabled.has(a.id)) {
          return false;
        }
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) || a.blurb.toLowerCase().includes(q)
        );
      })
      .map((a) => {
        const override = externalUrls.get(a.id);
        // A non-empty external_url from the settings API overrides the catalog default.
        return override ? { ...a, externalUrl: override } : a;
      });
  }, [disabled, externalUrls, query, showAdmin]);

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
