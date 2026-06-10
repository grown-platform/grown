import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  IconButton,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Divider,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  Textarea,
  Switch,
  Tooltip,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EditIcon from "@mui/icons-material/Edit";
import LinkIcon from "@mui/icons-material/Link";
import ArticleIcon from "@mui/icons-material/Article";
import TitleIcon from "@mui/icons-material/Title";
import NotesIcon from "@mui/icons-material/Notes";
import ImageIcon from "@mui/icons-material/Image";
import SmartButtonIcon from "@mui/icons-material/SmartButton";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import CodeIcon from "@mui/icons-material/Code";
import type { User } from "../../api/types";
import { Header } from "../../components/Header";
import {
  getSite,
  updateSite,
  uid,
  emptyPage,
  parseContent,
  serializeContent,
} from "./api";
import type { Block, BlockType, Page, SiteContent } from "./types";
import { PageView } from "./PageView";

const BLOCK_KINDS: { type: BlockType; label: string; icon: ReactNode }[] = [
  { type: "heading", label: "Heading", icon: <TitleIcon /> },
  { type: "text", label: "Text", icon: <NotesIcon /> },
  { type: "image", label: "Image", icon: <ImageIcon /> },
  { type: "button", label: "Button", icon: <SmartButtonIcon /> },
  { type: "divider", label: "Divider", icon: <HorizontalRuleIcon /> },
  { type: "embed", label: "Embed", icon: <CodeIcon /> },
];

function newBlock(type: BlockType): Block {
  return { id: uid("block"), type, text: "", url: "" };
}

interface SiteEditorProps {
  user: User;
}

export default function SiteEditor({ user }: SiteEditorProps) {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [content, setContent] = useState<SiteContent | null>(null);
  const [published, setPublished] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const [preview, setPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const dirty = useRef(false);

  // Load.
  useEffect(() => {
    let cancelled = false;
    getSite(id)
      .then((s) => {
        if (cancelled) return;
        setName(s.name);
        setPublished(s.published);
        setContent(parseContent(s.content_json));
      })
      .catch((e) => !cancelled && setLoadError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const page: Page | null = useMemo(
    () =>
      content ? (content.pages[activePage] ?? content.pages[0] ?? null) : null,
    [content, activePage],
  );

  // Mutate content and mark dirty.
  function mutate(fn: (c: SiteContent) => SiteContent) {
    setContent((cur) => (cur ? fn(cur) : cur));
    dirty.current = true;
    setSaveState("idle");
  }
  function mutatePage(fn: (p: Page) => Page) {
    mutate((c) => ({
      ...c,
      pages: c.pages.map((p, i) => (i === activePage ? fn(p) : p)),
    }));
  }

  // ---- page ops ----
  function addPage() {
    const title = window.prompt("Page title", "New page");
    if (!title) return;
    const p = emptyPage(title);
    p.path =
      "/" +
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    setContent((cur) => (cur ? { ...cur, pages: [...cur.pages, p] } : cur));
    dirty.current = true;
    setSaveState("idle");
    setActivePage(content?.pages.length ?? 1);
  }
  function deletePage(idx: number) {
    if (!content || content.pages.length <= 1) {
      window.alert("A site needs at least one page.");
      return;
    }
    if (
      !window.confirm(
        `Delete page “${content.pages[idx].title || "Untitled"}”?`,
      )
    )
      return;
    const pages = content.pages.filter((_, i) => i !== idx);
    setContent({ ...content, pages });
    dirty.current = true;
    setSaveState("idle");
    setActivePage((cur) =>
      Math.max(0, cur >= pages.length ? pages.length - 1 : cur),
    );
  }
  function setPageTitle(title: string) {
    mutatePage((p) => ({ ...p, title }));
  }

  // ---- block ops ----
  function addBlock(type: BlockType) {
    mutatePage((p) => ({ ...p, blocks: [...p.blocks, newBlock(type)] }));
  }
  function updateBlock(blockId: string, patch: Partial<Block>) {
    mutatePage((p) => ({
      ...p,
      blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }));
  }
  function moveBlock(idx: number, dir: -1 | 1) {
    mutatePage((p) => {
      const next = idx + dir;
      if (next < 0 || next >= p.blocks.length) return p;
      const blocks = [...p.blocks];
      [blocks[idx], blocks[next]] = [blocks[next], blocks[idx]];
      return { ...p, blocks };
    });
  }
  function deleteBlock(blockId: string) {
    mutatePage((p) => ({
      ...p,
      blocks: p.blocks.filter((b) => b.id !== blockId),
    }));
  }

  // ---- save / publish ----
  async function save(nextPublished = published) {
    if (!content) return;
    setSaveState("saving");
    try {
      await updateSite(id, {
        name,
        content_json: serializeContent(content),
        published: nextPublished,
      });
      dirty.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }
  async function togglePublish() {
    const next = !published;
    setPublished(next);
    await save(next);
  }

  if (loadError) {
    return (
      <>
        <Header user={user} />
        <Container sx={{ py: 8 }}>
          <Typography level="h3">Couldn’t open this site</Typography>
          <Typography sx={{ opacity: 0.7 }}>{loadError}</Typography>
          <Button
            sx={{ mt: 2 }}
            variant="outlined"
            onClick={() => navigate("/sites")}
          >
            Back to sites
          </Button>
        </Container>
      </>
    );
  }
  if (!content || !page) {
    return (
      <>
        <Header user={user} />
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        {/* Toolbar */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: 2,
            flexWrap: "wrap",
          }}
        >
          <IconButton
            variant="plain"
            onClick={() => navigate("/sites")}
            aria-label="Back to sites"
          >
            <ArrowBackIcon />
          </IconButton>
          <Input
            size="lg"
            variant="plain"
            value={name}
            placeholder="Untitled site"
            onChange={(e) => {
              setName(e.target.value);
              dirty.current = true;
              setSaveState("idle");
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              fontWeight: 600,
              "--Input-focusedThickness": "0px",
            }}
            data-testid="site-name"
          />
          {published && (
            <Tooltip title="Open public view">
              <IconButton
                variant="plain"
                component="a"
                href={`/sites/view/${id}`}
                target="_blank"
                aria-label="Open public view"
              >
                <LinkIcon />
              </IconButton>
            </Tooltip>
          )}
          <Button
            variant={preview ? "solid" : "outlined"}
            color="neutral"
            startDecorator={preview ? <EditIcon /> : <VisibilityIcon />}
            onClick={() => setPreview((v) => !v)}
            data-testid="toggle-preview"
          >
            {preview ? "Edit" : "Preview"}
          </Button>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography level="body-sm">Published</Typography>
            <Switch
              checked={published}
              onChange={togglePublish}
              data-testid="publish-toggle"
            />
          </Box>
          <Button
            onClick={() => save()}
            loading={saveState === "saving"}
            color={saveState === "error" ? "danger" : "primary"}
            data-testid="save-site"
          >
            {saveState === "saved" && !dirty.current ? "Saved" : "Save"}
          </Button>
        </Box>

        <Box
          sx={{
            display: "flex",
            gap: 3,
            flexDirection: { xs: "column", sm: "row" },
          }}
        >
          {/* Pages sidebar */}
          <Box sx={{ width: { xs: "100%", sm: 200 }, flexShrink: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
              <Typography level="body-xs" sx={{ flex: 1, opacity: 0.6, px: 1 }}>
                PAGES
              </Typography>
              <IconButton
                size="sm"
                variant="plain"
                onClick={addPage}
                aria-label="Add page"
              >
                <AddIcon />
              </IconButton>
            </Box>
            <List size="sm" sx={{ "--ListItem-radius": "8px" }}>
              {content.pages.map((p, i) => (
                <ListItem
                  key={p.id}
                  endAction={
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      onClick={() => deletePage(i)}
                      aria-label={`Delete ${p.title || "page"}`}
                    >
                      <DeleteIcon />
                    </IconButton>
                  }
                >
                  <ListItemButton
                    selected={i === activePage}
                    onClick={() => setActivePage(i)}
                  >
                    <ListItemDecorator>
                      <ArticleIcon />
                    </ListItemDecorator>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography level="body-sm" noWrap>
                        {p.title || "Untitled"}
                      </Typography>
                    </Box>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>

          {/* Page canvas */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {preview ? (
              <Sheet variant="outlined" sx={{ p: 3, borderRadius: "md" }}>
                <PageView page={page} />
              </Sheet>
            ) : (
              <>
                <Input
                  size="md"
                  value={page.title}
                  placeholder="Page title"
                  onChange={(e) => setPageTitle(e.target.value)}
                  sx={{ mb: 2, fontWeight: 600 }}
                  data-testid="page-title"
                />
                {page.blocks.map((b, i) => (
                  <BlockEditor
                    key={b.id}
                    block={b}
                    isFirst={i === 0}
                    isLast={i === page.blocks.length - 1}
                    onChange={(patch) => updateBlock(b.id, patch)}
                    onMoveUp={() => moveBlock(i, -1)}
                    onMoveDown={() => moveBlock(i, 1)}
                    onDelete={() => deleteBlock(b.id)}
                  />
                ))}
                {page.blocks.length === 0 && (
                  <Sheet
                    variant="soft"
                    sx={{
                      p: 4,
                      borderRadius: "md",
                      textAlign: "center",
                      mb: 2,
                    }}
                  >
                    <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                      No blocks yet. Add one below.
                    </Typography>
                  </Sheet>
                )}
                <Divider sx={{ my: 2 }}>
                  <Dropdown>
                    <MenuButton
                      variant="soft"
                      color="primary"
                      startDecorator={<AddIcon />}
                      size="sm"
                      data-testid="add-block"
                    >
                      Add block
                    </MenuButton>
                    <Menu placement="bottom">
                      {BLOCK_KINDS.map((k) => (
                        <MenuItem key={k.type} onClick={() => addBlock(k.type)}>
                          <ListItemDecorator>{k.icon}</ListItemDecorator>
                          {k.label}
                        </MenuItem>
                      ))}
                    </Menu>
                  </Dropdown>
                </Divider>
              </>
            )}
          </Box>
        </Box>
      </Container>
    </>
  );
}

interface BlockEditorProps {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Block>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function BlockEditor({
  block,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: BlockEditorProps) {
  return (
    <Sheet
      variant="outlined"
      sx={{
        p: 1.5,
        mb: 1.5,
        borderRadius: "md",
        "&:hover .block-actions": { opacity: 1 },
      }}
      data-testid={`block-${block.id}`}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Chip size="sm" variant="soft">
          {block.type}
        </Chip>
        <Box sx={{ flex: 1 }} />
        <Box
          className="block-actions"
          sx={{
            display: "flex",
            gap: 0.25,
            opacity: { xs: 1, md: 0.4 },
            transition: "opacity 120ms",
          }}
        >
          <IconButton
            size="sm"
            variant="plain"
            disabled={isFirst}
            onClick={onMoveUp}
            aria-label="Move up"
          >
            <ArrowUpwardIcon />
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            disabled={isLast}
            onClick={onMoveDown}
            aria-label="Move down"
          >
            <ArrowDownwardIcon />
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            color="danger"
            onClick={onDelete}
            aria-label="Delete block"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      </Box>
      <BlockFields block={block} onChange={onChange} />
    </Sheet>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Partial<Block>) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <Input
          value={block.text}
          placeholder="Heading text"
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );
    case "text":
      return (
        <Textarea
          minRows={3}
          value={block.text}
          placeholder="Write some text…"
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );
    case "image":
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Input
            value={block.url}
            placeholder="Image URL (https://…)"
            onChange={(e) => onChange({ url: e.target.value })}
          />
          <Input
            value={block.text}
            placeholder="Alt text (optional)"
            onChange={(e) => onChange({ text: e.target.value })}
          />
          {block.url && (
            <Box
              component="img"
              src={block.url}
              alt={block.text || ""}
              sx={{ maxWidth: 240, borderRadius: "8px" }}
            />
          )}
        </Box>
      );
    case "button":
      return (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Input
            value={block.text}
            placeholder="Button label"
            onChange={(e) => onChange({ text: e.target.value })}
            sx={{ flex: 1, minWidth: 160 }}
          />
          <Input
            value={block.url}
            placeholder="Link URL (https://…)"
            onChange={(e) => onChange({ url: e.target.value })}
            sx={{ flex: 1, minWidth: 160 }}
          />
        </Box>
      );
    case "divider":
      return (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          A horizontal divider.
        </Typography>
      );
    case "embed":
      return (
        <Input
          value={block.url}
          placeholder="Embed URL (iframe src, https://…)"
          onChange={(e) => onChange({ url: e.target.value })}
        />
      );
    default:
      return null;
  }
}
