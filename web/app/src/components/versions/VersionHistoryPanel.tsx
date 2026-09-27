import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Input,
  List,
  ListItemButton,
  ListItemContent,
  Sheet,
  Tooltip,
  Typography,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import RestoreIcon from "@mui/icons-material/Restore";
import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";
import {
  getVersion,
  listVersions,
  nameCurrentVersion,
  renameVersion,
  restoreVersion,
  type ObjectVersion,
  type VersionKind,
} from "./api";

export interface VersionHistoryPanelProps {
  kind: VersionKind;
  docId: string;
  open: boolean;
  onClose: () => void;
  /** Flush the editor's pending autosave so the server holds what the user
   *  sees (called before naming the current version and before restoring). */
  prepare?: () => Promise<void>;
  /** Called with the restored document data; the editor reloads from it. */
  onRestored: (data: string) => void;
  /** Read-only render of a version. `older` is the previous version's data
   *  (null for the first one), for highlighting what changed. */
  renderPreview: (data: string, older: string | null) => ReactNode;
  /** One line describing what changed from `older` to `newer`. */
  summarize: (older: string | null, newer: string) => string;
}

export function fmtVersionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Selected {
  v: ObjectVersion;
  data: string | null; // null while loading
  older: string | null;
  summary: string;
}

/** VersionHistoryPanel is File ▸ Version history for Sheets, Slides and
 *  Whiteboards: a right-hand panel listing saved versions (author, time,
 *  name), previewing one read-only with a "what changed" line, and naming,
 *  renaming and restoring versions. Restoring never deletes history. */
export function VersionHistoryPanel({
  kind,
  docId,
  open,
  onClose,
  prepare,
  onRestored,
  renderPreview,
  summarize,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<ObjectVersion[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Selected | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await listVersions(kind, docId);
      setVersions(r.versions);
      setCanEdit(r.canEdit);
      return r.versions;
    } catch {
      setError("Could not load version history.");
      setVersions([]);
      return [];
    }
  }, [kind, docId]);

  useEffect(() => {
    if (!open) return;
    setSel(null);
    setVersions(null);
    // Save pending edits first so the newest snapshot reflects the screen.
    (prepare ? prepare().catch(() => {}) : Promise.resolve()).then(load);
  }, [open, load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function select(v: ObjectVersion, list: ObjectVersion[]) {
    setSel({ v, data: null, older: null, summary: "" });
    setRenameDraft(v.label);
    setError("");
    try {
      const idx = list.findIndex((x) => x.id === v.id);
      const prev = idx >= 0 ? list[idx + 1] : undefined;
      const [full, older] = await Promise.all([
        getVersion(kind, docId, v.id),
        prev ? getVersion(kind, docId, prev.id) : Promise.resolve(null),
      ]);
      const data = full.data ?? "";
      const olderData = older?.data ?? null;
      setSel({
        v: full,
        data,
        older: olderData,
        summary: olderData === null ? "First saved version" : summarize(olderData, data) + " since the previous version",
      });
    } catch {
      setError("Could not load this version.");
    }
  }

  async function doName() {
    const label = nameDraft.trim();
    if (!label) return;
    setBusy(true);
    setError("");
    try {
      if (prepare) await prepare();
      await nameCurrentVersion(kind, docId, label);
      setNaming(false);
      setNameDraft("");
      await load();
    } catch (e) {
      setError(`Could not name the version. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doRename() {
    if (!sel) return;
    setBusy(true);
    setError("");
    try {
      const v = await renameVersion(kind, docId, sel.v.id, renameDraft.trim());
      setSel({ ...sel, v: { ...sel.v, label: v.label, is_auto: v.is_auto } });
      await load();
    } catch (e) {
      setError(`Rename failed. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    if (!sel) return;
    setBusy(true);
    setError("");
    try {
      if (prepare) await prepare();
      const r = await restoreVersion(kind, docId, sel.v.id);
      onRestored(r.data);
    } catch (e) {
      setError(`Restore failed. ${(e as Error).message}`);
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Sheet
      variant="outlined"
      data-testid="version-history"
      role="complementary"
      aria-label="Version history"
      sx={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: { xs: "100vw", sm: 460 },
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
        boxShadow: "lg",
        borderTop: 0,
        borderBottom: 0,
        borderRight: 0,
        bgcolor: "background.surface",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5 }}>
        <HistoryIcon />
        <Typography level="title-md" sx={{ flex: 1 }}>
          Version history
        </Typography>
        <IconButton size="sm" variant="plain" aria-label="Close version history" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

      {sel ? (
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Button
              size="sm"
              variant="plain"
              sx={{ alignSelf: "flex-start" }}
              onClick={() => {
                setSel(null);
                setError("");
              }}
            >
              ← All versions
            </Button>
            <Typography level="title-sm" data-testid="version-title">
              {sel.v.label || fmtVersionTime(sel.v.created_at)}
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.75 }}>
              {sel.v.author_name || "Unknown"} · {fmtVersionTime(sel.v.created_at)}
            </Typography>
            {sel.data !== null && (
              <Typography level="body-sm" color="primary" data-testid="version-summary">
                {sel.summary}
              </Typography>
            )}
            {canEdit && (
              <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                <Input
                  size="sm"
                  placeholder="Name this version"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doRename();
                  }}
                  slotProps={{ input: { "aria-label": "Version name", maxLength: 200 } }}
                  sx={{ flex: 1 }}
                />
                <Button
                  size="sm"
                  variant="outlined"
                  disabled={busy || renameDraft.trim() === sel.v.label}
                  onClick={doRename}
                >
                  Rename
                </Button>
              </Box>
            )}
          </Box>
          <Divider />
          <Box
            data-testid="version-preview"
            sx={{ flex: 1, overflow: "auto", p: 1, bgcolor: "#fff", color: "#202124" }}
          >
            {sel.data === null ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                {error ? (
                  <Typography level="body-sm" color="danger">
                    {error}
                  </Typography>
                ) : (
                  <CircularProgress size="sm" />
                )}
              </Box>
            ) : sel.data === "" ? (
              <Typography level="body-sm" sx={{ opacity: 0.6, p: 1 }}>
                This version is empty.
              </Typography>
            ) : (
              renderPreview(sel.data, sel.older)
            )}
          </Box>
          <Divider />
          <Box sx={{ p: 1.5 }}>
            {error && sel.data !== null && (
              <Typography level="body-xs" color="danger" sx={{ mb: 1 }}>
                {error}
              </Typography>
            )}
            {canEdit ? (
              <Button
                fullWidth
                startDecorator={<RestoreIcon />}
                loading={busy}
                disabled={sel.data === null}
                onClick={doRestore}
              >
                Restore this version
              </Button>
            ) : (
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                You can view versions but not restore them (view-only access).
              </Typography>
            )}
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {canEdit && (
            <Box sx={{ p: 1.5, pb: 0.5 }}>
              {naming ? (
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Input
                    size="sm"
                    autoFocus
                    placeholder="Version name"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void doName();
                      if (e.key === "Escape") setNaming(false);
                    }}
                    slotProps={{ input: { "aria-label": "Version name", maxLength: 200 } }}
                    sx={{ flex: 1 }}
                  />
                  <Button size="sm" loading={busy} disabled={!nameDraft.trim()} onClick={doName}>
                    Save
                  </Button>
                </Box>
              ) : (
                <Button
                  size="sm"
                  variant="soft"
                  startDecorator={<BookmarkAddIcon />}
                  onClick={() => setNaming(true)}
                >
                  Name current version
                </Button>
              )}
            </Box>
          )}
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {error && (
              <Box sx={{ p: 2 }}>
                <Typography level="body-sm" color="danger">
                  {error}
                </Typography>
                <Button size="sm" variant="soft" sx={{ mt: 1 }} onClick={() => void load()}>
                  Retry
                </Button>
              </Box>
            )}
            {!error && versions === null && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress size="sm" />
              </Box>
            )}
            {!error && versions !== null && versions.length === 0 && (
              <Typography level="body-sm" sx={{ p: 2, opacity: 0.6 }}>
                No saved versions yet. Versions are saved automatically as you edit (at most every 10
                minutes, and when everyone closes the file), or use “Name current version”.
              </Typography>
            )}
            {versions && versions.length > 0 && (
              <List sx={{ "--ListItem-radius": "8px", p: 1 }}>
                {versions.map((v, i) => (
                  <ListItemButton
                    key={v.id}
                    data-testid="version-item"
                    onClick={() => void select(v, versions)}
                  >
                    <ListItemContent>
                      <Typography level="body-sm" sx={{ fontWeight: v.label ? 600 : 400 }}>
                        {v.label || fmtVersionTime(v.created_at)}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                        {v.author_name || "Unknown"}
                        {v.label ? ` · ${fmtVersionTime(v.created_at)}` : ""}
                      </Typography>
                    </ListItemContent>
                    {i === 0 && (
                      <Chip size="sm" variant="soft" color="success">
                        newest
                      </Chip>
                    )}
                    {v.restored_from && (
                      <Chip size="sm" variant="soft" color="primary">
                        restore
                      </Chip>
                    )}
                    {v.is_auto && (
                      <Tooltip title="Saved automatically">
                        <Chip size="sm" variant="soft" color="neutral">
                          auto
                        </Chip>
                      </Tooltip>
                    )}
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        </Box>
      )}
    </Sheet>
  );
}
