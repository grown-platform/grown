import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container,
  Box,
  Input,
  IconButton,
  Sheet,
  Button,
  Divider,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DescriptionIcon from "@mui/icons-material/Description";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import StarIcon from "@mui/icons-material/Star";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import { useEditor, EditorContent } from "@tiptap/react";

import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import TocIcon from "@mui/icons-material/Toc";

import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getDoc,
  renameDoc,
  createDoc,
  trashDoc,
  updatePreview,
  snapshotNow,
} from "./api";
import { createCollab, colorFor } from "./collab";
import { buildExtensions } from "./extensions";
import {
  editorPageSx,
  workspaceSx,
  pageDims,
  type Orientation,
} from "./editorStyles";
import { Toolbar, type EditorMode } from "./Toolbar";
import { MenuBar, type DocActions } from "./MenuBar";
import { Presence } from "./Presence";
import { Ruler, type Indents } from "./Ruler";
import { ShareDialog } from "./ShareDialog";
import { CommandPalette, type Command } from "./CommandPalette";
import {
  DownloadDialog,
  EmojiDialog,
  SpecialCharsDialog,
  FindReplaceDialog,
  PageSetupDialog,
} from "./dialogs";
import { VersionHistory } from "./VersionHistory";
import { Outline } from "./Outline";
import { Footnotes } from "./Footnotes";
import { MarginEditor } from "./MarginEditor";
import { Suggestions } from "./Suggestions";
import { Comments, type CommentsHandle } from "./Comments";
import { EditorContextMenu } from "./EditorContextMenu";
import { ShortcutsDialog } from "./ShortcutsDialog";

interface DocEditorProps {
  user: User;
}

export function DocEditor({ user }: DocEditorProps) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Untitled document");
  const [starred, setStarred] = useState(false);
  const [indents, setIndents] = useState<Indents>({
    left: 1,
    right: 1,
    firstLine: 0,
  });
  const [mode, setMode] = useState<EditorMode>("editing");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [showPageNumbers, setShowPageNumbers] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const pageRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<CommentsHandle>(null);
  const [dialog, setDialog] = useState<
    | null
    | "share"
    | "download"
    | "emoji"
    | "specials"
    | "find"
    | "menus"
    | "pagesetup"
    | "shortcuts"
  >(null);
  // Right-hand side panel: version history, comments, or suggestions.
  const [panel, setPanel] = useState<
    null | "versions" | "comments" | "suggestions"
  >(null);
  // Track-changes ("Suggesting") mode.
  const [suggesting, setSuggesting] = useState(false);
  // Left-hand outline (table of contents) pane.
  const [showOutline, setShowOutline] = useState(false);
  // Header/footer margin regions (bound to named Yjs fragments).
  const [showHeaderFooter, setShowHeaderFooter] = useState(false);

  const collab = useMemo(() => createCollab(id), [id]);
  useEffect(() => () => collab.destroy(), [collab]);

  // Reveal the header/footer regions automatically once their Yjs fragments
  // gain content (so a doc that already has them shows them on open).
  useEffect(() => {
    const ydoc = collab.ydoc;
    const check = () => {
      const has =
        ydoc.getXmlFragment("header").length > 0 ||
        ydoc.getXmlFragment("footer").length > 0;
      if (has) setShowHeaderFooter(true);
    };
    check();
    ydoc.on("update", check);
    return () => ydoc.off("update", check);
  }, [collab]);

  const editor = useEditor(
    {
      extensions: buildExtensions({
        ydoc: collab.ydoc,
        provider: collab.provider,
        userName: user.display_name || user.email,
        userColor: colorFor(user.id),
        editable: true,
      }),
    },
    [collab],
  );

  useEffect(() => {
    let cancelled = false;
    getDoc(id)
      .then((d) => !cancelled && setTitle(d.title))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Editing vs Viewing mode: actually toggle ProseMirror editability.
  // Suggesting implies editable (edits become tracked suggestions).
  useEffect(() => {
    editor?.setEditable(mode === "editing" || suggesting);
  }, [editor, mode, suggesting]);

  // Mirror the Suggesting toggle into the editor's suggestion plugin storage.
  useEffect(() => {
    editor?.commands.setSuggesting(suggesting);
  }, [editor, suggesting]);

  // Track how many pages the content spans, for page-number labels.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const { h } = pageDims(orientation);
    const update = () =>
      setPageCount(Math.max(1, Math.ceil(el.scrollHeight / h)));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [orientation, editor]);

  // Debounced thumbnail save: a few seconds after the last edit, store a small
  // HTML preview for the Docs home grid.
  useEffect(() => {
    if (!editor) return;
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        updatePreview(id, editor.getHTML().slice(0, 8000)).catch(() => {});
      }, 2500);
    };
    editor.on("update", save);
    return () => {
      window.clearTimeout(timer);
      editor.off("update", save);
    };
  }, [editor, id]);

  // Periodic auto-snapshot: while the doc is being edited, capture a version at
  // most once every few minutes so version history fills in without spamming
  // rows. The client owns the rendered HTML, so it produces the snapshot.
  const lastSnapshot = useRef(0);
  useEffect(() => {
    if (!editor) return;
    const MIN_INTERVAL = 3 * 60 * 1000; // 3 minutes
    let timer: number | undefined;
    const maybeSnapshot = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const now = Date.now();
        if (now - lastSnapshot.current < MIN_INTERVAL) return;
        if (editor.getText().trim() === "") return;
        lastSnapshot.current = now;
        snapshotNow(id, editor.getHTML(), "", true).catch(() => {
          // A failed auto-snapshot is non-fatal; retry on the next edit window.
          lastSnapshot.current = 0;
        });
      }, 8000);
    };
    editor.on("update", maybeSnapshot);
    return () => {
      window.clearTimeout(timer);
      editor.off("update", maybeSnapshot);
    };
  }, [editor, id]);

  // Seed content when arriving from "Make a copy".
  useEffect(() => {
    if (!editor) return;
    const seed = sessionStorage.getItem(`docseed:${id}`);
    if (seed && editor.getText().trim() === "") {
      editor.commands.setContent(seed);
      sessionStorage.removeItem(`docseed:${id}`);
    }
  }, [editor, id]);

  async function commitTitle() {
    const t = title.trim() || "Untitled document";
    setTitle(t);
    try {
      await renameDoc(id, t);
    } catch {
      /* keep local title */
    }
  }

  const actions: DocActions = {
    newDoc: async () => {
      const d = await createDoc();
      navigate(`/docs/d/${d.id}`);
    },
    open: () => navigate("/docs"),
    makeCopy: async () => {
      const d = await createDoc(`Copy of ${title}`);
      if (editor) sessionStorage.setItem(`docseed:${d.id}`, editor.getHTML());
      navigate(`/docs/d/${d.id}`);
    },
    rename: () =>
      (
        document.querySelector(
          '[aria-label="Document title"]',
        ) as HTMLInputElement | null
      )?.focus(),
    trash: async () => {
      await trashDoc(id);
      navigate("/docs");
    },
    share: () => setDialog("share"),
    download: () => setDialog("download"),
    docDetails: () => {
      const words = (editor?.getText().trim().match(/\S+/g) || []).length;
      window.alert(`Title: ${title}\nWords: ${words}`);
    },
    wordCount: () => {
      const words = (editor?.getText().trim().match(/\S+/g) || []).length;
      window.alert(`${words} word${words === 1 ? "" : "s"}`);
    },
    findReplace: () => setDialog("find"),
    emoji: () => setDialog("emoji"),
    specialChars: () => setDialog("specials"),
    pageSetup: () => setDialog("pagesetup"),
    togglePageNumbers: () => setShowPageNumbers((s) => !s),
    versionHistory: () => setPanel("versions"),
    nameVersion: async () => {
      const name = window.prompt("Name this version");
      if (name === null) return;
      if (!editor) return;
      try {
        await snapshotNow(
          id,
          editor.getHTML(),
          name.trim() || "Named version",
          false,
        );
        lastSnapshot.current = Date.now();
        setPanel("versions");
      } catch {
        window.alert("Could not save version. Please try again.");
      }
    },
    comments: () => setPanel("comments"),
    commentOnSelection: () => {
      setPanel("comments");
      // Let the panel mount, then capture the current selection into a draft.
      setTimeout(() => {
        if (!commentsRef.current?.startFromSelection()) {
          window.alert("Select some text first, then add a comment.");
        }
      }, 0);
    },
    searchMenus: () => setDialog("menus"),
    shortcuts: () => setDialog("shortcuts"),
    toggleOutline: () => setShowOutline((s) => !s),
    insertFootnote: () => editor?.chain().focus().insertFootnote().run(),
    toggleHeaderFooter: () => setShowHeaderFooter((s) => !s),
    toggleSuggesting: () => {
      setSuggesting((s) => {
        const next = !s;
        setPanel(next ? "suggestions" : null);
        return next;
      });
    },
  };

  // Global editor shortcuts not handled by TipTap: command palette (Alt+/),
  // keyboard-shortcuts overlay (Ctrl+/), comment (Ctrl+Alt+M), and version
  // history (Ctrl+Alt+Shift+H).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "/") {
        e.preventDefault();
        setDialog("menus");
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "/") {
        e.preventDefault();
        setDialog("shortcuts");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.altKey &&
        (e.key === "m" || e.key === "M")
      ) {
        e.preventDefault();
        actions.commentOnSelection();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.altKey &&
        e.shiftKey &&
        (e.key === "h" || e.key === "H")
      ) {
        e.preventDefault();
        setPanel("versions");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id]);

  const commands: Command[] = useMemo(() => {
    if (!editor) return [];
    const e = editor;
    return [
      {
        label: "Bold",
        section: "Format",
        run: () => e.chain().focus().toggleBold().run(),
      },
      {
        label: "Italic",
        section: "Format",
        run: () => e.chain().focus().toggleItalic().run(),
      },
      {
        label: "Underline",
        section: "Format",
        run: () => e.chain().focus().toggleUnderline().run(),
      },
      {
        label: "Strikethrough",
        section: "Format",
        run: () => e.chain().focus().toggleStrike().run(),
      },
      {
        label: "Heading 1",
        section: "Format",
        run: () => e.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        label: "Heading 2",
        section: "Format",
        run: () => e.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        label: "Bulleted list",
        section: "Insert",
        run: () => e.chain().focus().toggleBulletList().run(),
      },
      {
        label: "Numbered list",
        section: "Insert",
        run: () => e.chain().focus().toggleOrderedList().run(),
      },
      {
        label: "Checklist",
        section: "Insert",
        run: () => e.chain().focus().toggleTaskList().run(),
      },
      {
        label: "Table",
        section: "Insert",
        run: () =>
          e
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
      },
      {
        label: "Horizontal line",
        section: "Insert",
        run: () => e.chain().focus().setHorizontalRule().run(),
      },
      {
        label: "Footnote",
        section: "Insert",
        run: () => e.chain().focus().insertFootnote().run(),
      },
      { label: "Insert emoji", section: "Insert", run: actions.emoji },
      {
        label: "Special characters",
        section: "Insert",
        run: actions.specialChars,
      },
      {
        label: "Clear formatting",
        section: "Format",
        run: () => e.chain().focus().clearNodes().unsetAllMarks().run(),
      },
      {
        label: "Undo",
        section: "Edit",
        run: () => e.chain().focus().undo().run(),
      },
      {
        label: "Redo",
        section: "Edit",
        run: () => e.chain().focus().redo().run(),
      },
      { label: "Find and replace", section: "Edit", run: actions.findReplace },
      { label: "Download", section: "File", run: actions.download },
      { label: "Share", section: "File", run: actions.share },
      { label: "Make a copy", section: "File", run: actions.makeCopy },
      { label: "Print", section: "File", run: () => window.print() },
      { label: "Word count", section: "Tools", run: actions.wordCount },
      {
        label: "Version history",
        section: "File",
        run: actions.versionHistory,
      },
      {
        label: "Name current version",
        section: "File",
        run: actions.nameVersion,
      },
      { label: "Comments", section: "View", run: actions.comments },
      {
        label: "Show document outline",
        section: "View",
        run: actions.toggleOutline,
      },
      {
        label: "Headers & footers",
        section: "Insert",
        run: actions.toggleHeaderFooter,
      },
      {
        label: "Suggesting mode (track changes)",
        section: "View",
        run: actions.toggleSuggesting,
      },
      {
        label: "Comment on selection",
        section: "Insert",
        run: actions.commentOnSelection,
      },
      { label: "Keyboard shortcuts", section: "Help", run: actions.shortcuts },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, title]);

  return (
    <>
      <Header user={user} />

      <Sheet variant="plain" sx={{ px: 2, pt: 1, bgcolor: "background.body" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            variant="plain"
            aria-label="Back to Docs"
            onClick={() => navigate("/docs")}
          >
            <ArrowBackIcon />
          </IconButton>
          <DescriptionIcon sx={{ color: "#3D5A80", fontSize: 28 }} />
          <Box sx={{ minWidth: 0 }}>
            <Input
              value={title}
              variant="plain"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              sx={{
                fontSize: "1.1rem",
                fontWeight: 500,
                "--Input-focusedThickness": "0",
                px: 0.5,
              }}
              slotProps={{ input: { "aria-label": "Document title" } }}
            />
            <MenuBar editor={editor} actions={actions} title={title} />
          </Box>
          <IconButton
            variant="plain"
            size="sm"
            aria-label="Star"
            onClick={() => setStarred((s) => !s)}
          >
            {starred ? (
              <StarIcon sx={{ color: "#f4b400" }} />
            ) : (
              <StarBorderIcon />
            )}
          </IconButton>
          <Box sx={{ flex: 1 }} />
          <Presence provider={collab.provider} />
          <IconButton
            variant={showOutline ? "soft" : "plain"}
            size="sm"
            aria-label="Show document outline"
            onClick={() => setShowOutline((s) => !s)}
          >
            <TocIcon />
          </IconButton>
          <IconButton
            variant={panel === "comments" ? "soft" : "plain"}
            size="sm"
            aria-label="Comments"
            onClick={() =>
              setPanel((p) => (p === "comments" ? null : "comments"))
            }
          >
            <ChatBubbleOutlineIcon />
          </IconButton>
          <Button
            startDecorator={<PersonAddIcon />}
            onClick={() => setDialog("share")}
            sx={{
              borderRadius: "xl",
              display: { xs: "none", sm: "inline-flex" },
            }}
          >
            Share
          </Button>
          <IconButton
            variant="solid"
            color="primary"
            onClick={() => setDialog("share")}
            aria-label="Share"
            sx={{ display: { xs: "flex", sm: "none" }, borderRadius: "50%" }}
          >
            <PersonAddIcon />
          </IconButton>
        </Box>
      </Sheet>

      <Divider />

      <Container maxWidth="lg" sx={{ py: 1.5 }}>
        <Toolbar
          editor={editor}
          onOpenMenus={() => setDialog("menus")}
          mode={mode}
          onModeChange={setMode}
        />
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <Ruler indents={indents} onChange={setIndents} />
        </Box>
      </Container>

      <Box sx={{ display: "flex", alignItems: "stretch", minHeight: "70vh" }}>
        {showOutline && (
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <Outline editor={editor} onClose={() => setShowOutline(false)} />
          </Box>
        )}
        <Box sx={{ ...workspaceSx, flex: 1, minWidth: 0 }}>
          <Sheet
            ref={pageRef}
            variant="plain"
            sx={editorPageSx(indents, orientation)}
            data-testid="doc-editor"
          >
            {showHeaderFooter && (
              <Box className="doc-header-region">
                <MarginEditor
                  ydoc={collab.ydoc}
                  field="header"
                  editable={mode === "editing"}
                  placeholder="Header"
                />
              </Box>
            )}
            <EditorContent editor={editor} />
            <Footnotes editor={editor} />
            {showHeaderFooter && (
              <Box className="doc-footer-region">
                <MarginEditor
                  ydoc={collab.ydoc}
                  field="footer"
                  editable={mode === "editing"}
                  placeholder="Footer"
                />
              </Box>
            )}
            {showPageNumbers &&
              Array.from({ length: pageCount }, (_, i) => (
                <Box
                  key={i}
                  sx={{
                    position: "absolute",
                    right: 24,
                    top: `${(i + 1) * pageDims(orientation).h - 30}px`,
                    fontSize: 11,
                    color: "#80868b",
                    pointerEvents: "none",
                  }}
                >
                  {i + 1}
                </Box>
              ))}
          </Sheet>
        </Box>
        {panel === "versions" && (
          <>
            <Box
              onClick={() => setPanel(null)}
              sx={{
                display: { xs: "block", md: "none" },
                position: "fixed",
                inset: 0,
                bgcolor: "rgba(0,0,0,0.4)",
                zIndex: 1200,
              }}
            />
            <Box
              sx={{
                position: { xs: "fixed", md: "relative" },
                top: { xs: 0, md: "auto" },
                right: { xs: 0, md: "auto" },
                bottom: { xs: 0, md: "auto" },
                zIndex: { xs: 1201, md: 1 },
                width: { xs: "min(320px, 100vw)", md: "auto" },
                height: { xs: "100vh", md: "auto" },
                overflowY: { xs: "auto", md: "visible" },
              }}
            >
              <VersionHistory
                docId={id}
                editor={editor}
                onClose={() => setPanel(null)}
              />
            </Box>
          </>
        )}
        {panel === "comments" && (
          <>
            <Box
              onClick={() => setPanel(null)}
              sx={{
                display: { xs: "block", md: "none" },
                position: "fixed",
                inset: 0,
                bgcolor: "rgba(0,0,0,0.4)",
                zIndex: 1200,
              }}
            />
            <Box
              sx={{
                position: { xs: "fixed", md: "relative" },
                top: { xs: 0, md: "auto" },
                right: { xs: 0, md: "auto" },
                bottom: { xs: 0, md: "auto" },
                zIndex: { xs: 1201, md: 1 },
                width: { xs: "min(320px, 100vw)", md: "auto" },
                height: { xs: "100vh", md: "auto" },
                overflowY: { xs: "auto", md: "visible" },
              }}
            >
              <Comments
                ref={commentsRef}
                docId={id}
                editor={editor}
                onClose={() => setPanel(null)}
              />
            </Box>
          </>
        )}
        {panel === "suggestions" && (
          <>
            <Box
              onClick={() => setPanel(null)}
              sx={{
                display: { xs: "block", md: "none" },
                position: "fixed",
                inset: 0,
                bgcolor: "rgba(0,0,0,0.4)",
                zIndex: 1200,
              }}
            />
            <Box
              sx={{
                position: { xs: "fixed", md: "relative" },
                top: { xs: 0, md: "auto" },
                right: { xs: 0, md: "auto" },
                bottom: { xs: 0, md: "auto" },
                zIndex: { xs: 1201, md: 1 },
                width: { xs: "min(320px, 100vw)", md: "auto" },
                height: { xs: "100vh", md: "auto" },
                overflowY: { xs: "auto", md: "visible" },
              }}
            >
              <Suggestions editor={editor} onClose={() => setPanel(null)} />
            </Box>
          </>
        )}
      </Box>

      <EditorContextMenu
        editor={editor}
        onComment={() => actions.commentOnSelection()}
      />
      <ShortcutsDialog
        open={dialog === "shortcuts"}
        onClose={() => setDialog(null)}
      />

      <ShareDialog
        open={dialog === "share"}
        onClose={() => setDialog(null)}
        docId={id}
      />
      <DownloadDialog
        open={dialog === "download"}
        onClose={() => setDialog(null)}
        editor={editor}
        title={title}
      />
      <EmojiDialog
        open={dialog === "emoji"}
        onClose={() => setDialog(null)}
        editor={editor}
      />
      <SpecialCharsDialog
        open={dialog === "specials"}
        onClose={() => setDialog(null)}
        editor={editor}
      />
      <FindReplaceDialog
        open={dialog === "find"}
        onClose={() => setDialog(null)}
        editor={editor}
      />
      <PageSetupDialog
        open={dialog === "pagesetup"}
        onClose={() => setDialog(null)}
        orientation={orientation}
        onChange={setOrientation}
      />
      <CommandPalette
        open={dialog === "menus"}
        onClose={() => setDialog(null)}
        commands={commands}
      />
    </>
  );
}
