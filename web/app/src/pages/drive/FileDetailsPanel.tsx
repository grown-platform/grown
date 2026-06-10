import { useEffect, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  IconButton,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Button,
  Avatar,
  Divider,
  Stack,
  FormControl,
  FormLabel,
  Select,
  Option,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import type { DriveFile, DriveShare } from "./types";
import { isFolder } from "./types";
import {
  listShares,
  createShare,
  revokeShare,
  downloadURL,
  listFileGrants,
  grantFileAccess,
  revokeFileAccess,
} from "./api";
import { PeopleGrants } from "../../components/PeopleGrants";

interface FileDetailsPanelProps {
  file: DriveFile;
  /** Called when the user closes the panel. */
  onClose: () => void;
  /** Called when "Open file" is clicked — navigates to the viewer. */
  onOpen: (id: string) => void;
  /** If true, the Manage access section starts expanded. Default false. */
  initialManageOpen?: boolean;
  /** Authenticated user — used to render the owner as "You" + initial. */
  currentUser?: { id: string; display_name: string };
  /** Human-readable location of the file (parent folder name, or "My Drive"). */
  locationName?: string;
}

/**
 * Right-side drawer-style panel showing file details, who-has-access, and
 * sharing controls. Matches the Google Drive details-panel structure:
 *   header (icon + name + close)
 *   tabs (Details / Activity / Approvals — only Details functional in V1)
 *   preview thumbnail (images only V1; other types get a generic icon)
 *   "Who has access" with active share tokens + Manage access flow
 *   File information (mime, size, dates)
 *   Security limitations + Labels (stubs)
 */
export function FileDetailsPanel({
  file,
  onClose,
  onOpen,
  initialManageOpen,
  currentUser,
  locationName,
}: FileDetailsPanelProps) {
  const [shares, setShares] = useState<DriveShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(initialManageOpen ?? false);
  const [newRole, setNewRole] = useState<"viewer" | "commenter" | "editor">(
    "viewer",
  );
  const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSharesLoading(true);
    listShares(file.id)
      .then((s) => {
        if (!cancelled) {
          setShares(s);
          setSharesLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSharesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  const refreshShares = async () => {
    try {
      const s = await listShares(file.id);
      setShares(s);
    } catch (e) {
      alert("Reload shares failed: " + (e as Error).message);
    }
  };

  const handleCreate = async () => {
    try {
      const created = await createShare(file.id, newRole);
      setLastCreatedToken(created.token);
      await refreshShares();
    } catch (e) {
      alert("Create share failed: " + (e as Error).message);
    }
  };

  const handleRevoke = async (token: string) => {
    if (!confirm("Revoke this share?")) return;
    try {
      await revokeShare(token);
      if (lastCreatedToken === token) setLastCreatedToken(null);
      await refreshShares();
    } catch (e) {
      alert("Revoke failed: " + (e as Error).message);
    }
  };

  const isImage = !isFolder(file) && file.mime_type.startsWith("image/");
  // Resolve owner against the signed-in user. When they match we render "You";
  // otherwise we fall back to the raw owner id (full directory lookup is a
  // follow-up). The avatar shows the owner's first initial.
  const isOwnedByMe = currentUser != null && currentUser.id === file.owner_id;
  const ownerName = isOwnedByMe
    ? "You"
    : file.owner_id
      ? "Another user"
      : "Unknown";
  const ownerDisplay = isOwnedByMe ? currentUser!.display_name : ownerName;
  const ownerInitial =
    (isOwnedByMe ? currentUser!.display_name : ownerName)
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  return (
    <Sheet
      variant="outlined"
      sx={{
        width: { xs: "100%", md: 360 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderTop: 0,
        borderRight: 0,
        borderBottom: 0,
        borderLeft: { xs: "none", md: "1px solid" },
        borderColor: "divider",
        bgcolor: "background.surface",
        minHeight: { xs: "unset", md: "calc(100vh - 64px)" },
      }}
      data-testid="file-details-panel"
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        {isFolder(file) ? (
          <Icons.Folder color="primary" />
        ) : isImage ? (
          <Icons.Image color="primary" />
        ) : (
          <Icons.InsertDriveFile color="primary" />
        )}
        <Typography
          level="title-md"
          sx={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </Typography>
        <IconButton
          variant="plain"
          size="sm"
          onClick={onClose}
          aria-label="Close details"
        >
          <Icons.Close />
        </IconButton>
      </Box>

      {/* Tabs */}
      <Tabs
        defaultValue="details"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: "transparent",
        }}
      >
        <TabList
          tabFlex={1}
          sx={{ borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab value="details">Details</Tab>
          <Tab value="activity" disabled>
            Activity
          </Tab>
          <Tab value="approvals" disabled>
            Approvals
          </Tab>
        </TabList>

        <TabPanel value="details" sx={{ flex: 1, overflow: "auto", p: 2 }}>
          {/* Preview thumbnail */}
          <Box
            sx={{
              mb: 2,
              borderRadius: "md",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.level1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 160,
              maxHeight: 240,
              overflow: "hidden",
            }}
          >
            {isImage ? (
              <img
                src={downloadURL(file.id)}
                alt={file.name}
                style={{ maxWidth: "100%", maxHeight: 240, display: "block" }}
              />
            ) : isFolder(file) ? (
              <Icons.Folder
                sx={{ fontSize: 80, opacity: 0.35, color: "primary.500" }}
              />
            ) : (
              <Icons.InsertDriveFile sx={{ fontSize: 80, opacity: 0.35 }} />
            )}
          </Box>

          {/* Open button */}
          {!isFolder(file) && (
            <Button
              onClick={() => onOpen(file.id)}
              variant="soft"
              startDecorator={<Icons.OpenInNew />}
              sx={{ mb: 2, width: "100%" }}
              data-testid="panel-open-file"
            >
              Open file
            </Button>
          )}

          {/* Who has access */}
          <SectionTitle>Who has access</SectionTitle>
          {sharesLoading ? (
            <Typography level="body-sm" sx={{ opacity: 0.6 }}>
              Loading…
            </Typography>
          ) : (
            <Stack direction="column" spacing={1} sx={{ mb: 1 }}>
              {/* Owner row (always present) */}
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Avatar size="sm" color="warning">
                  {ownerInitial}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    level="body-sm"
                    sx={{
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ownerDisplay}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                    Owner
                  </Typography>
                </Box>
              </Stack>
              {shares.length === 0 && (
                <Typography level="body-sm" sx={{ opacity: 0.7, pl: 5 }}>
                  Private to you
                </Typography>
              )}
              {shares.map((s) => (
                <ShareRow
                  key={s.token}
                  share={s}
                  onRevoke={() => handleRevoke(s.token)}
                />
              ))}
            </Stack>
          )}

          <Button
            variant="outlined"
            size="sm"
            startDecorator={
              manageOpen ? <Icons.ExpandLess /> : <Icons.PersonAdd />
            }
            onClick={() => setManageOpen(!manageOpen)}
            sx={{ mt: 1, borderRadius: "xl" }}
          >
            {manageOpen ? "Done" : "Manage access"}
          </Button>

          {manageOpen && (
            <Sheet variant="soft" sx={{ p: 1.5, mt: 1.5, borderRadius: "md" }}>
              {/* Per-user ACL grants: share with specific people (cross-org). */}
              <PeopleGrants
                listGrants={() => listFileGrants(file.id)}
                grantAccess={async (uid, r) =>
                  await grantFileAccess(file.id, uid, r)
                }
                revokeAccess={(uid) => revokeFileAccess(file.id, uid)}
              />

              <Divider sx={{ my: 1.5 }} />
              <Typography level="title-sm" sx={{ mb: 0.5 }}>
                Anyone with the link
              </Typography>
              <FormControl size="sm" sx={{ mb: 1 }}>
                <FormLabel>Role</FormLabel>
                <Select
                  value={newRole}
                  onChange={(_, v) => v && setNewRole(v)}
                  data-testid="share-role-select"
                >
                  <Option value="viewer">Viewer</Option>
                  <Option value="commenter">Commenter</Option>
                  <Option value="editor">Editor</Option>
                </Select>
              </FormControl>
              <Button
                size="sm"
                onClick={handleCreate}
                startDecorator={<Icons.Add />}
                sx={{ width: "100%" }}
                data-testid="share-create-link"
              >
                Create share link
              </Button>
              {lastCreatedToken && (
                <Sheet
                  variant="outlined"
                  sx={{
                    mt: 1.5,
                    p: 1,
                    borderRadius: "sm",
                    bgcolor: "background.surface",
                  }}
                >
                  <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.8 }}>
                    Share link (copy this):
                  </Typography>
                  <Typography
                    level="body-xs"
                    sx={{
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      userSelect: "all",
                    }}
                  >
                    {`${window.location.origin}/drive/share/${lastCreatedToken}`}
                  </Typography>
                </Sheet>
              )}
            </Sheet>
          )}

          <Divider sx={{ my: 2 }} />

          {/* File information */}
          <SectionTitle icon={<Icons.InfoOutlined fontSize="small" />}>
            File information
          </SectionTitle>
          <Stack direction="column" spacing={0.5} sx={{ mt: 1 }}>
            <InfoRow
              label="Type"
              value={isFolder(file) ? "Folder" : file.mime_type}
            />
            {!isFolder(file) && (
              <InfoRow
                label="Size"
                value={formatBytes(Number(file.size_bytes))}
              />
            )}
            <InfoRow label="Owner" value={ownerDisplay} />
            <InfoRow label="Location" value={locationName ?? "My Drive"} />
            <InfoRow label="Modified" value={formatDate(file.updated_at)} />
            <InfoRow label="Created" value={formatDate(file.created_at)} />
          </Stack>

          <Divider sx={{ my: 2 }} />

          {/* Security limitations stub */}
          <SectionTitle icon={<Icons.Shield fontSize="small" />}>
            Security limitations
          </SectionTitle>
          <Sheet variant="soft" sx={{ p: 1.5, mt: 1, borderRadius: "sm" }}>
            <Typography level="body-sm">No limitations applied</Typography>
            <Typography level="body-xs" sx={{ opacity: 0.7, mt: 0.5 }}>
              If any are applied, they will appear here.
            </Typography>
          </Sheet>

          <Divider sx={{ my: 2 }} />

          {/* Labels stub */}
          <SectionTitle icon={<Icons.Label fontSize="small" />}>
            Labels
          </SectionTitle>
          <Button
            size="sm"
            variant="soft"
            startDecorator={<Icons.Add />}
            disabled
            sx={{ mt: 1, borderRadius: "xl" }}
          >
            Apply label
          </Button>
          <Typography level="body-xs" sx={{ opacity: 0.7, mt: 1 }}>
            No labels yet. Labels are a follow-up.
          </Typography>
        </TabPanel>
      </Tabs>
    </Sheet>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
      {icon && <Box sx={{ display: "flex", color: "neutral.500" }}>{icon}</Box>}
      <Typography level="title-sm">{children}</Typography>
    </Stack>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      sx={{ py: 0.25, gap: 1 }}
    >
      <Typography level="body-sm" sx={{ opacity: 0.7, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        level="body-sm"
        sx={{
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function ShareRow({
  share,
  onRevoke,
}: {
  share: DriveShare;
  onRevoke: () => void;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <Avatar size="sm" color="primary">
        <Icons.Link fontSize="small" />
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography level="body-sm" sx={{ fontWeight: 500 }}>
          Anyone with the link
        </Typography>
        <Typography
          level="body-xs"
          sx={{ opacity: 0.6, textTransform: "capitalize" }}
        >
          {share.role}
        </Typography>
      </Box>
      <IconButton
        size="sm"
        variant="plain"
        color="danger"
        onClick={onRevoke}
        title="Revoke"
      >
        <Icons.LinkOff fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(unixSecs: string): string {
  const n = Number(unixSecs);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString();
}
