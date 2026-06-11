// ---------------------------------------------------------------------------
// Admin roles — a focused "who holds admin in this org" view. Org admin is a
// binary grant (grown.org_admins), so this surfaces the current admins and lets
// you grant/revoke it directly, reusing the same usersApi.setAdmin path as the
// per-row toggle in the Users section. Deeper per-user actions stay in Users.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Input,
  Sheet,
  Table,
  Typography,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import SearchIcon from "@mui/icons-material/Search";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import {
  listUsers,
  setAdmin,
  userLabel,
  adminWhoAmI,
  ServiceTokenMissingError,
  ForbiddenError,
  LastAdminError,
  type AdminUser,
} from "./usersApi";

export function RolesSection() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  // Inline "grant admin" picker: a debounced search over non-admin users.
  const [granting, setGranting] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[]>([]);

  useEffect(() => {
    let alive = true;
    adminWhoAmI()
      .then((w) => {
        if (alive) setIsSuperAdmin(w.isSuperAdmin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setNeedsToken(false);
    setForbidden(false);
    try {
      setUsers(await listUsers(""));
    } catch (e) {
      setUsers([]);
      if (e instanceof ServiceTokenMissingError) setNeedsToken(true);
      else if (e instanceof ForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced search for the grant picker (non-admins only).
  useEffect(() => {
    if (!granting) return;
    const t = setTimeout(
      async () => {
        try {
          const list = await listUsers(query);
          setResults(list.filter((u) => !u.isAdmin));
        } catch {
          setResults([]);
        }
      },
      query ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [granting, query]);

  const admins = useMemo(
    () => (users ?? []).filter((u) => u.isAdmin),
    [users],
  );

  async function grant(u: AdminUser, next: boolean) {
    if (!next && !window.confirm(`Remove admin access from ${userLabel(u)}?`))
      return;
    setBusyId(u.id);
    setError(null);
    try {
      await setAdmin(u.id, next);
      await load();
      setNotice(
        next
          ? `${userLabel(u)} is now an admin.`
          : `Removed admin access from ${userLabel(u)}.`,
      );
      if (next) {
        // Drop the freshly-promoted user from the picker results.
        setResults((r) => r.filter((x) => x.id !== u.id));
        setQuery("");
      }
    } catch (e) {
      if (e instanceof LastAdminError)
        setError("You can't remove the last admin of the organization.");
      else setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (needsToken) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Admin roles
        </Typography>
        <Sheet
          variant="soft"
          color="warning"
          sx={{ p: 3, borderRadius: "md", textAlign: "center" }}
        >
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            Role management is unavailable
          </Typography>
          <Typography level="body-sm">
            Set <code>GROWN_ZITADEL_SERVICE_TOKEN</code> on the server to manage
            roles.
          </Typography>
        </Sheet>
      </>
    );
  }

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Admin roles
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to manage roles. Ask an org admin to add
          your email to <code>GROWN_ADMIN_EMAILS</code>.
        </Alert>
      </>
    );
  }

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography level="h4">Admin roles</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Who can administer this organization. Admins can manage users,
            services, security, and settings.
          </Typography>
        </Box>
        {!granting && (
          <Button
            size="sm"
            startDecorator={<PersonAddIcon />}
            onClick={() => {
              setGranting(true);
              setQuery("");
            }}
            disabled={users === null}
            data-testid="admin-grant-open"
          >
            Grant admin
          </Button>
        )}
      </Box>

      {notice && (
        <Alert color="success" variant="soft" sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Grant picker */}
      {granting && (
        <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2, mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 1.5,
              flexWrap: "wrap",
            }}
          >
            <Typography level="title-sm" sx={{ flex: 1 }}>
              Grant admin to a member
            </Typography>
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              onClick={() => setGranting(false)}
            >
              Done
            </Button>
          </Box>
          <Input
            size="sm"
            autoFocus
            startDecorator={<SearchIcon />}
            placeholder="Search members"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ mb: 1 }}
            data-testid="admin-grant-search"
          />
          <Sheet
            variant="soft"
            sx={{ borderRadius: "sm", maxHeight: 240, overflowY: "auto" }}
          >
            {results.length === 0 ? (
              <Typography
                level="body-xs"
                sx={{ opacity: 0.6, textAlign: "center", py: 2 }}
              >
                {query ? "No matching non-admin members." : "Start typing to find members."}
              </Typography>
            ) : (
              results.map((u) => (
                <Box
                  key={u.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    px: 1.5,
                    py: 1,
                  }}
                >
                  <Avatar size="sm">
                    {(userLabel(u) || "?").charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="body-sm" noWrap>
                      {userLabel(u)}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                      {u.email}
                    </Typography>
                  </Box>
                  <Button
                    size="sm"
                    variant="soft"
                    loading={busyId === u.id}
                    onClick={() => grant(u, true)}
                    data-testid={`admin-grant-${u.id}`}
                  >
                    Make admin
                  </Button>
                </Box>
              ))
            )}
          </Sheet>
        </Sheet>
      )}

      {users === null && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {users !== null && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden", overflowX: "auto" }}
        >
          <Table
            hoverRow
            sx={{ "--TableCell-paddingX": { xs: "8px", sm: "16px" }, minWidth: 420 }}
          >
            <thead>
              <tr>
                <th style={{ width: "45%" }}>Admin</th>
                <th>Email</th>
                <th style={{ width: 130 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {admins.map((u) => (
                <tr key={u.id} data-testid={`admin-role-${u.id}`}>
                  <td>
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 1.25 }}
                    >
                      <Avatar size="sm">
                        {(userLabel(u) || "?").charAt(0).toUpperCase()}
                      </Avatar>
                      <Typography
                        level="body-sm"
                        sx={{ fontWeight: 500 }}
                        noWrap
                        endDecorator={
                          <Chip
                            size="sm"
                            variant="soft"
                            color="primary"
                            startDecorator={<Icons.Shield sx={{ fontSize: 14 }} />}
                          >
                            Admin
                          </Chip>
                        }
                      >
                        {userLabel(u)}
                      </Typography>
                    </Box>
                  </td>
                  <td>
                    <Typography level="body-sm" noWrap>
                      {u.email}
                    </Typography>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="plain"
                      color="danger"
                      loading={busyId === u.id}
                      onClick={() => grant(u, false)}
                      data-testid={`admin-revoke-${u.id}`}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {admins.length === 0 && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No admins yet.
              </Typography>
            </Box>
          )}
        </Sheet>
      )}

      {isSuperAdmin && (
        <Typography level="body-xs" sx={{ opacity: 0.6, mt: 1.5 }}>
          You’re a super-admin (<code>GROWN_ADMIN_EMAILS</code>), which is
          granted server-side and isn’t shown in this org list.
        </Typography>
      )}
    </>
  );
}
