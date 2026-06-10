import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Button,
  Card,
  Sheet,
  Box,
  CircularProgress,
  IconButton,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  ListDivider,
  AspectRatio,
  Select,
  Option,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import DescriptionIcon from "@mui/icons-material/Description";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listDocs,
  createDoc,
  trashDoc,
  renameDoc,
  setTemplate,
  listDocsSharedWithMe,
} from "./api";
import type { Doc } from "./types";
import { TemplateGallery } from "./TemplateGallery";
import { templateHtml, type DocTemplate } from "./templates";

interface DocListProps {
  user: User;
}

type View = "grid" | "list";
type Owner = "anyone" | "me" | "notme" | "shared";
type Sort = "opened" | "modifiedByMe" | "modified" | "title";

const SORT_LABELS: Record<Sort, string> = {
  opened: "Last opened by me",
  modifiedByMe: "Last modified by me",
  modified: "Last modified",
  title: "Title",
};

// Per-user "last opened" timestamps, kept client-side (we don't track opens
// server-side). Used by the "Last opened by me" sort.
function readOpens(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem("docs:opened") || "{}");
  } catch {
    return {};
  }
}
function recordOpen(id: string) {
  const m = readOpens();
  m[id] = Date.now();
  try {
    localStorage.setItem("docs:opened", JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

function Thumbnail({ html }: { html?: string }) {
  if (html && html.trim()) {
    return (
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          bgcolor: "#fff",
          overflow: "hidden",
        }}
      >
        <Box
          dangerouslySetInnerHTML={{ __html: html }}
          sx={{
            position: "absolute",
            top: 12,
            left: 14,
            width: "200%",
            transform: "scale(0.5)",
            transformOrigin: "top left",
            pointerEvents: "none",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#202124",
            "& *": { maxWidth: "100%" },
            "& img": { maxWidth: "100%", height: "auto" },
            "& h1": { fontSize: 20 },
            "& h2": { fontSize: 16 },
            "& table": { borderCollapse: "collapse" },
            "& td, & th": { border: "1px solid #ccc", padding: "2px 4px" },
          }}
        />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        bgcolor: "#fff",
        p: 1.5,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          width: "55%",
          height: 7,
          bgcolor: "#c9d3e0",
          borderRadius: 1,
          mb: 1,
        }}
      />
      {[80, 95, 70, 90, 60, 88, 75].map((w, i) => (
        <Box
          key={i}
          sx={{
            width: `${w}%`,
            height: 4,
            bgcolor: "#e6e9ee",
            borderRadius: 1,
            mb: 0.75,
          }}
        />
      ))}
    </Box>
  );
}

function TypeIcon({ title }: { title: string }) {
  const isWord = /\.docx?$/i.test(title);
  if (isWord) {
    return (
      <Box
        sx={{
          width: 18,
          height: 18,
          borderRadius: "3px",
          bgcolor: "#2b579a",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        W
      </Box>
    );
  }
  return <DescriptionIcon sx={{ color: "#3D5A80", fontSize: 20 }} />;
}

export function DocList({ user }: DocListProps) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [view, setView] = useState<View>(
    () => (localStorage.getItem("docs:view") as View) || "grid",
  );
  const [owner, setOwner] = useState<Owner>("anyone");
  const [sort, setSort] = useState<Sort>("modified");

  useEffect(() => {
    localStorage.setItem("docs:view", view);
  }, [view]);

  // Load either the org's docs or, in the "Shared with me" filter, the
  // cross-org docs granted to the caller (object_grants).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const load = owner === "shared" ? listDocsSharedWithMe() : listDocs();
    load
      .then((d) => !cancelled && setDocs(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [owner]);

  // Documents flagged as templates surface in the gallery, not the main list.
  const userTemplates: DocTemplate[] = useMemo(
    () =>
      (docs ?? [])
        .filter((d) => d.is_template)
        .map((d) => ({
          id: `user-${d.id}`,
          name: d.title,
          subtitle: "Your template",
          html: d.preview_html ?? "",
        })),
    [docs],
  );

  const shown = useMemo(() => {
    if (!docs) return [];
    const opens = readOpens();
    const byUpdated = (a: Doc, b: Doc) =>
      +new Date(b.updated_at) - +new Date(a.updated_at);
    // In the "shared" filter the list is already the granted-to-me set; only the
    // owner-based predicates filter further.
    let list = docs
      .filter((d) => !d.is_template)
      .filter((d) =>
        owner === "me"
          ? d.owner_id === user.id
          : owner === "notme"
            ? d.owner_id !== user.id
            : true,
      );
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "opened":
          return (opens[b.id] || 0) - (opens[a.id] || 0) || byUpdated(a, b);
        case "modifiedByMe": {
          const mine = (d: Doc) => (d.owner_id === user.id ? 1 : 0);
          return mine(b) - mine(a) || byUpdated(a, b);
        }
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return byUpdated(a, b);
      }
    });
    return list;
  }, [docs, owner, sort, user.id]);

  function openDoc(id: string) {
    recordOpen(id);
    navigate(`/docs/d/${id}`);
  }

  async function onCreate() {
    setCreating(true);
    try {
      const doc = await createDoc();
      recordOpen(doc.id);
      navigate(`/docs/d/${doc.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  // Create a new doc seeded from a template's HTML (handed off via sessionStorage,
  // applied by the editor on first load).
  async function onPickTemplate(t: DocTemplate) {
    try {
      const doc = await createDoc(t.id === "blank" ? "" : t.name);
      if (t.html) sessionStorage.setItem(`docseed:${doc.id}`, templateHtml(t));
      recordOpen(doc.id);
      navigate(`/docs/d/${doc.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onTrash(id: string) {
    await trashDoc(id);
    setDocs((cur) => (cur ?? []).filter((d) => d.id !== id));
  }
  async function onRename(d: Doc) {
    const t = window.prompt("Rename document", d.title);
    if (t && t !== d.title) {
      const updated = await renameDoc(d.id, t);
      setDocs((cur) => (cur ?? []).map((x) => (x.id === d.id ? updated : x)));
    }
  }
  function copyLink(id: string) {
    navigator.clipboard
      ?.writeText(`${location.origin}/docs/d/${id}`)
      .catch(() => {});
  }
  async function onSaveTemplate(d: Doc) {
    const updated = await setTemplate(d.id, true);
    setDocs((cur) => (cur ?? []).map((x) => (x.id === d.id ? updated : x)));
  }

  const rowMenu = (d: Doc) => (
    <Dropdown>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{
          root: { size: "sm", variant: "plain", "aria-label": "More" },
        }}
      >
        <MoreVertIcon />
      </MenuButton>
      <Menu size="sm" placement="bottom-end">
        <MenuItem onClick={() => onRename(d)}>Rename</MenuItem>
        <MenuItem onClick={() => copyLink(d.id)}>Copy link</MenuItem>
        <MenuItem onClick={() => window.open(`/docs/d/${d.id}`, "_blank")}>
          Open in new tab
        </MenuItem>
        <MenuItem onClick={() => onSaveTemplate(d)}>Save as template</MenuItem>
        <MenuItem disabled>Available offline</MenuItem>
        <ListDivider />
        <MenuItem color="danger" onClick={() => onTrash(d.id)}>
          Remove
        </MenuItem>
      </Menu>
    </Dropdown>
  );

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Typography level="h2" sx={{ flex: 1 }}>
            Docs
          </Typography>
          <Button
            startDecorator={<AddIcon />}
            loading={creating}
            onClick={onCreate}
            data-testid="new-doc"
          >
            New document
          </Button>
        </Box>

        <TemplateGallery
          onPick={onPickTemplate}
          userTemplates={userTemplates}
        />

        {/* Controls: ownership filter · sort · grid/list toggle */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mb: 2,
            flexWrap: "wrap",
          }}
        >
          <Select
            size="sm"
            value={owner}
            onChange={(_, v) => v && setOwner(v)}
            sx={{ minWidth: 160 }}
          >
            <Option value="anyone">Owned by anyone</Option>
            <Option value="me">Owned by me</Option>
            <Option value="notme">Not owned by me</Option>
            <Option value="shared">Shared with me</Option>
          </Select>
          <Select
            size="sm"
            value={sort}
            onChange={(_, v) => v && setSort(v)}
            sx={{ minWidth: 180 }}
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
              <Option key={s} value={s}>
                {SORT_LABELS[s]}
              </Option>
            ))}
          </Select>
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup
            size="sm"
            value={view}
            onChange={(_, v) => v && setView(v as View)}
          >
            <Tooltip title="Grid view" size="sm">
              <IconButton value="grid" aria-label="Grid view">
                <GridViewIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="List view" size="sm">
              <IconButton value="list" aria-label="List view">
                <ViewListIcon />
              </IconButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">
              Couldn’t load documents: {error}
            </Typography>
          </Sheet>
        )}
        {docs === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {docs !== null && shown.length === 0 && (
          <Sheet
            variant="soft"
            sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
          >
            <Typography level="body-lg" sx={{ opacity: 0.7 }}>
              No documents to show.
            </Typography>
          </Sheet>
        )}

        {view === "grid" ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 2,
            }}
          >
            {shown.map((d) => (
              <Card
                key={d.id}
                variant="outlined"
                data-testid={`doc-${d.id}`}
                sx={{
                  p: 0,
                  overflow: "hidden",
                  cursor: "pointer",
                  "&:hover": {
                    boxShadow: "md",
                    borderColor: "primary.outlinedBorder",
                  },
                }}
              >
                <AspectRatio
                  ratio="4/5"
                  onClick={() => openDoc(d.id)}
                  sx={{ borderRadius: 0 }}
                >
                  <Thumbnail html={d.preview_html} />
                </AspectRatio>
                <Box
                  sx={{
                    p: 1.25,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1,
                  }}
                >
                  <TypeIcon title={d.title} />
                  <Box
                    sx={{ flex: 1, minWidth: 0 }}
                    onClick={() => openDoc(d.id)}
                  >
                    <Typography level="body-sm" noWrap sx={{ fontWeight: 500 }}>
                      {d.title}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      {new Date(d.updated_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                  {rowMenu(d)}
                </Box>
              </Card>
            ))}
          </Box>
        ) : (
          <Sheet
            variant="outlined"
            sx={{ borderRadius: "md", overflow: "hidden" }}
          >
            {shown.map((d, i) => (
              <Box
                key={d.id}
                data-testid={`doc-${d.id}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 1.25,
                  cursor: "pointer",
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                  "&:hover": { bgcolor: "background.level1" },
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    flex: 1,
                    minWidth: 0,
                  }}
                  onClick={() => openDoc(d.id)}
                >
                  <TypeIcon title={d.title} />
                  <Typography
                    level="body-sm"
                    noWrap
                    sx={{ flex: 1, fontWeight: 500 }}
                  >
                    {d.title}
                  </Typography>
                  <Typography
                    level="body-xs"
                    sx={{ opacity: 0.6, width: 110, textAlign: "right" }}
                  >
                    {new Date(d.updated_at).toLocaleDateString()}
                  </Typography>
                </Box>
                {rowMenu(d)}
              </Box>
            ))}
          </Sheet>
        )}
      </Container>
    </>
  );
}
