import { useEffect, useRef, useState } from "react";
import {
  Box,
  Stack,
  Input,
  Select,
  Option,
  Button,
  List,
  ListItem,
  ListItemButton,
  IconButton,
  Chip,
  Typography,
  Divider,
  CircularProgress,
  Sheet,
} from "@mui/joy";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  searchDirectory,
  type Member,
  type ObjectGrant,
} from "../api/directory";

export interface PeopleGrantsProps {
  /** Lists current per-user grants on the object. */
  listGrants: () => Promise<ObjectGrant[]>;
  /** Grants userId the given role; resolves to the created/updated grant. */
  grantAccess: (userId: string, role: string) => Promise<ObjectGrant | void>;
  /** Revokes userId's grant. */
  revokeAccess: (userId: string) => Promise<void>;
}

const ROLE_LABEL: Record<string, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
};

/**
 * PeopleGrants is the shared "share with specific people" panel used by Drive
 * and Docs: a directory-backed user picker + role select, plus the list of
 * current grantees with revoke. It does NOT own the transport — the parent
 * passes list/grant/revoke callbacks wired to the right app endpoint.
 */
export function PeopleGrants({
  listGrants,
  grantAccess,
  revokeAccess,
}: PeopleGrantsProps) {
  const [grants, setGrants] = useState<ObjectGrant[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [picked, setPicked] = useState<Member | null>(null);
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listGrants()
      .then(setGrants)
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced directory search. Skips while a member is already picked.
  useEffect(() => {
    if (picked) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q === "") {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      searchDirectory(q)
        .then(setResults)
        .catch(() => setResults([]));
    }, 200);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, picked]);

  async function onGrant() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await grantAccess(picked.id, role);
      // Re-list so the grantee's resolved name/email is authoritative.
      setGrants(await listGrants());
      setPicked(null);
      setQuery("");
      setResults([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(userId: string) {
    setError(null);
    try {
      await revokeAccess(userId);
      setGrants((cur) =>
        (cur ?? []).filter((g) => g.grantee_user_id !== userId),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Stack spacing={1.5}>
      <Box sx={{ position: "relative" }}>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Input
            placeholder={
              picked
                ? picked.name || picked.email
                : "Add people by name or email"
            }
            value={picked ? "" : query}
            onChange={(e) => {
              setPicked(null);
              setQuery(e.target.value);
            }}
            startDecorator={
              picked ? (
                <Chip size="sm" variant="soft" color="primary">
                  {picked.name || picked.email}
                </Chip>
              ) : undefined
            }
            sx={{ flex: 1 }}
          />
          <Select
            value={role}
            onChange={(_, v) => v && setRole(v)}
            sx={{ minWidth: 130 }}
          >
            <Option value="viewer">Viewer</Option>
            <Option value="commenter">Commenter</Option>
            <Option value="editor">Editor</Option>
          </Select>
          <Button
            onClick={onGrant}
            loading={busy}
            disabled={!picked}
            startDecorator={<PersonAddIcon />}
          >
            Share
          </Button>
        </Box>

        {/* Autocomplete dropdown of directory matches. */}
        {!picked && results.length > 0 && (
          <Sheet
            variant="outlined"
            sx={{
              position: "absolute",
              zIndex: 10,
              mt: 0.5,
              width: "100%",
              borderRadius: "sm",
              maxHeight: 220,
              overflow: "auto",
              boxShadow: "md",
            }}
          >
            <List size="sm">
              {results.map((m) => (
                <ListItem key={m.id}>
                  <ListItemButton
                    onClick={() => {
                      setPicked(m);
                      setResults([]);
                    }}
                  >
                    <Box>
                      <Typography level="body-sm">
                        {m.name || m.email}
                      </Typography>
                      {m.name && (
                        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                          {m.email}
                        </Typography>
                      )}
                    </Box>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Sheet>
        )}
      </Box>

      {error && (
        <Typography color="danger" level="body-sm">
          {error}
        </Typography>
      )}

      <Divider />
      <Typography level="title-sm">People with access</Typography>
      {grants === null && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size="sm" />
        </Box>
      )}
      {grants?.length === 0 && (
        <Typography level="body-sm" sx={{ opacity: 0.6 }}>
          Not shared with anyone yet.
        </Typography>
      )}
      <List sx={{ "--ListItem-paddingY": "6px" }}>
        {grants?.map((g) => (
          <ListItem key={g.grantee_user_id}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                minWidth: 0,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography level="body-sm" noWrap>
                  {g.grantee_name || g.grantee_email}
                </Typography>
                {g.grantee_name && (
                  <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                    {g.grantee_email}
                  </Typography>
                )}
              </Box>
              <Chip
                size="sm"
                variant="soft"
                color={g.role === "editor" ? "primary" : "neutral"}
                sx={{ flexShrink: 0 }}
              >
                {ROLE_LABEL[g.role] ?? g.role}
              </Chip>
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                aria-label="Remove access"
                sx={{ flexShrink: 0 }}
                onClick={() => onRevoke(g.grantee_user_id)}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Box>
          </ListItem>
        ))}
      </List>
    </Stack>
  );
}
