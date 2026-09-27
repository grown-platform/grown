import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  Box,
  Typography,
  IconButton,
  List,
  ListItemButton,
  ListItemContent,
  Button,
  CircularProgress,
  Divider,
  Chip,
  Tooltip,
  Switch,
  Select,
  Option,
} from "@mui/joy";
import { DOMSerializer } from "@tiptap/pm/model";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import RestoreIcon from "@mui/icons-material/Restore";
import type { Editor } from "@tiptap/react";
import {
  listVersions,
  getVersion,
  restoreVersion,
  type DocVersion,
} from "./api";
import { diffSummary, diffVersions, htmlToDoc } from "./diff";
import { createDocFrom } from "./diff/sources";

interface VersionHistoryProps {
  docId: string;
  editor: Editor | null;
  onClose: () => void;
  /** Author for changes in the current document (Compare with current). */
  userName?: string;
}

/** What a highlighted version is compared with (Docs M12). */
type DiffBase = "previous" | "current";
type DiffShow = "changes" | "deleted";

// The preview pane's review colours (the editor's are scoped to .ProseMirror).
const diffSx = {
  "& .suggestion-insert": { color: "#188038", textDecoration: "underline" },
  "& .suggestion-delete": { color: "#d93025", textDecoration: "line-through" },
  "& .suggestion-format": { borderBottom: "2px dotted #8e24aa" },
  "& [data-para-change-type]::after": { content: '"¶"', marginLeft: "2px" },
  "& [data-para-change-type='insert']::after": { color: "#188038" },
  "& [data-para-change-type='delete']::after": { color: "#d93025" },
  "& [data-props-change]": { backgroundColor: "rgba(142, 36, 170, 0.07)" },
};

function fmtTime(iso: string): string {
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

/** VersionHistory is the File → Version history sidebar: it lists saved
 *  versions, previews a selected version's content, and restores it into the
 *  live document. */
export function VersionHistory({
  docId,
  editor,
  onClose,
  userName = "",
}: VersionHistoryProps) {
  const navigate = useNavigate();
  const [highlight, setHighlight] = useState(false);
  const [base, setBase] = useState<DiffBase>("previous");
  const [show, setShow] = useState<DiffShow>("changes");
  const [older, setOlder] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    setVersions(null);
    listVersions(docId)
      .then(setVersions)
      .catch(() => setError("Could not load version history."));
  }, [docId]);

  useEffect(() => {
    load();
  }, [load]);

  async function selectVersion(v: DocVersion) {
    setSelected(v);
    setPreview(null);
    setOlder(null);
    try {
      const full = await getVersion(docId, v.id);
      setPreview(full.content_html);
    } catch {
      setPreview("");
      setError("Could not load this version.");
    }
  }

  async function doRestore() {
    if (!selected || !editor) return;
    setBusy(true);
    setError("");
    try {
      const restored = await restoreVersion(docId, selected.id);
      // Load the restored content into the live document so collaborators see it.
      editor.commands.setContent(restored.content_html || preview || "");
      setSelected(null);
      setPreview(null);
      load();
    } catch {
      setError("Restore failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // The version before the selected one (the list is newest first).
  const prevVersion = useMemo(() => {
    if (!selected || !versions) return null;
    const i = versions.findIndex((v) => v.id === selected.id);
    return i >= 0 ? (versions[i + 1] ?? null) : null;
  }, [selected, versions]);

  useEffect(() => {
    if (!highlight || base !== "previous" || !prevVersion) return;
    let live = true;
    getVersion(docId, prevVersion.id)
      .then((v) => live && setOlder(v.content_html ?? ""))
      .catch(() => live && setOlder(""));
    return () => {
      live = false;
    };
  }, [highlight, base, prevVersion, docId]);

  // Highlighted changes: the selected version against the one before it,
  // or the current document against the selected version.
  const diff = useMemo(() => {
    if (!highlight || !editor || !selected || preview === null) return null;
    try {
      const schema = editor.schema;
      let a;
      let b;
      let author;
      let date;
      if (base === "current") {
        a = htmlToDoc(schema, preview);
        b = editor.state.doc;
        author = userName || "Current document";
        date = undefined;
      } else {
        if (!prevVersion) a = htmlToDoc(schema, "<p></p>");
        else if (older === null) return null;
        else a = htmlToDoc(schema, older);
        b = htmlToDoc(schema, preview);
        author = selected.author_name || "Unknown";
        date = selected.created_at?.replace(/\.\d+Z$/, "Z");
      }
      const doc = diffVersions(a, b, { author, date, show });
      const holder = document.createElement("div");
      holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
      return { doc, html: holder.innerHTML, summary: diffSummary(doc) };
    } catch {
      return null;
    }
  }, [highlight, editor, selected, preview, base, prevVersion, older, show, userName]);

  async function openDiffAsDoc() {
    if (!diff || !editor || !selected) return;
    setBusy(true);
    try {
      const label = selected.label || fmtTime(selected.created_at);
      const id = await createDocFrom(editor, `Changes in ${label}`, diff.doc);
      navigate(`/docs/d/${id}`);
    } catch {
      setError("Could not create the document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      variant="outlined"
      sx={{
        width: 320,
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderTop: 0,
        borderBottom: 0,
        borderRight: 0,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5 }}>
        <HistoryIcon />
        <Typography level="title-md" sx={{ flex: 1 }}>
          Version history
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Close version history"
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

      {selected ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <Box sx={{ p: 1.5 }}>
            <Button
              size="sm"
              variant="plain"
              onClick={() => {
                setSelected(null);
                setPreview(null);
              }}
            >
              ← Back to all versions
            </Button>
            <Typography level="body-sm" sx={{ mt: 0.5 }}>
              {selected.label || fmtTime(selected.created_at)}
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              {selected.author_name} · {fmtTime(selected.created_at)}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <Switch
                size="sm"
                checked={highlight}
                onChange={(e) => setHighlight(e.target.checked)}
                slotProps={{ input: { "data-testid": "version-highlight" } as Record<string, unknown> }}
              />
              <Typography level="body-sm">Highlight changes</Typography>
            </Box>
            {highlight && (
              <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                <Select size="sm" value={base} onChange={(_, v) => v && setBase(v as DiffBase)} sx={{ flex: 1 }} data-testid="version-diff-base">
                  <Option value="previous">Since previous version</Option>
                  <Option value="current">Up to the current document</Option>
                </Select>
                <Select size="sm" value={show} onChange={(_, v) => v && setShow(v as DiffShow)} sx={{ flex: 1 }} data-testid="version-diff-show">
                  <Option value="changes">All changes</Option>
                  <Option value="deleted">Deleted text only</Option>
                </Select>
              </Box>
            )}
            {highlight && diff && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                <Typography level="body-xs" sx={{ flex: 1 }} data-testid="version-diff-summary">
                  {diff.summary.insertions} insertion{diff.summary.insertions === 1 ? "" : "s"}, {diff.summary.deletions} deletion
                  {diff.summary.deletions === 1 ? "" : "s"}
                  {diff.summary.formatting ? `, ${diff.summary.formatting} formatting` : ""}
                </Typography>
                <Button size="sm" variant="plain" onClick={openDiffAsDoc} disabled={busy}>
                  Open as document
                </Button>
              </Box>
            )}
          </Box>
          <Divider />
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
              p: 1.5,
              bgcolor: "#fff",
              color: "#202124",
            }}
          >
            {preview === null ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress size="sm" />
              </Box>
            ) : preview === "" ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                This version is empty.
              </Typography>
            ) : (
              <Box
                data-testid="version-preview"
                sx={{ fontSize: 14, "& *": { maxWidth: "100%" }, ...diffSx }}
                dangerouslySetInnerHTML={{ __html: diff ? diff.html : preview }}
              />
            )}
          </Box>
          <Divider />
          <Box sx={{ p: 1.5 }}>
            {error && (
              <Typography level="body-xs" color="danger" sx={{ mb: 1 }}>
                {error}
              </Typography>
            )}
            <Button
              fullWidth
              startDecorator={<RestoreIcon />}
              loading={busy}
              disabled={!editor || preview === null}
              onClick={doRestore}
            >
              Restore this version
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {error && (
            <Box sx={{ p: 2 }}>
              <Typography level="body-sm" color="danger">
                {error}
              </Typography>
              <Button size="sm" variant="soft" sx={{ mt: 1 }} onClick={load}>
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
              No saved versions yet. Versions are saved automatically as you
              edit, or use “Name current version”.
            </Typography>
          )}
          {versions && versions.length > 0 && (
            <List sx={{ "--ListItem-radius": "8px", p: 1 }}>
              {versions.map((v) => (
                <ListItemButton key={v.id} onClick={() => selectVersion(v)}>
                  <ListItemContent>
                    <Typography
                      level="body-sm"
                      sx={{ fontWeight: v.label ? 600 : 400 }}
                    >
                      {v.label || fmtTime(v.created_at)}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      {v.author_name}
                      {v.label ? ` · ${fmtTime(v.created_at)}` : ""}
                    </Typography>
                  </ListItemContent>
                  {v.is_auto && (
                    <Tooltip title="Automatic snapshot">
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
      )}
    </Sheet>
  );
}
