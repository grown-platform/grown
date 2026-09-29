import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
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
import { useEditor, EditorContent, type Editor } from "@tiptap/react";

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
  addComment,
  replyToComment,
  resolveComment,
} from "./api";
import { hasDocxSeed, takeDocxSeed } from "./docx/seed";
import { setExportDocId } from "./export";
import { createCollab, colorFor } from "./collab";
import { buildExtensions } from "./extensions";
import { editorPageSx, pagedSheetSx, workspaceSx } from "./editorStyles";
import { Toolbar, type EditorMode } from "./Toolbar";
import { MenuBar, type DocActions } from "./MenuBar";
import { Presence } from "./Presence";
import { Ruler, type Indents } from "./Ruler";
import { ParagraphDialogs } from "./ParagraphDialogs";
import { TableDialogs, TableSettings, onOpenTableSettings, openConvertTextDialog, openTableSettings } from "./TableUI";
import { ObjectDialogs, ObjectSettings, onOpenObjectSettings, openInsertObject, openObjectSettings } from "./ObjectsUI";
import { setAssetDoc } from "./docAssets";
import { distributeColumns, distributeRows, splitTable, tableToText, toggleRepeatHeader } from "./tables";
import { selectedParagraphIndents } from "./docModel";
import { ShareDialog } from "./ShareDialog";
import { CommandPalette, type Command } from "./CommandPalette";
import {
  DownloadDialog,
  EmojiDialog,
  SpecialCharsDialog,
  CustomSpacingDialog,
} from "./dialogs";
import { LayoutDialogs, openLayoutDialog } from "./LayoutDialogs";
import { PageBackground, PageHeadersFooters } from "./PageLayer";
import { PageThumbnails, PrintPreview, StatusBar, usePagination } from "./PagesUI";
import { currentSection, setSectionProps } from "./pageLayout";
import { ptToPx } from "./sections";
import { VersionHistory } from "./VersionHistory";
import { Outline } from "./Outline";
import { Footnotes } from "./Footnotes";
import { Endnotes } from "./Endnotes";
import { MarginEditor } from "./MarginEditor";
import { Suggestions, type ReviewSource, type TrackControls } from "./Suggestions";
import { ReviewPopover } from "./ReviewPopover";
import {
  effectiveTracking,
  getTrackAll,
  governingEveryone,
  loadDisplayMode,
  loadTrackDefault,
  loadTrackMine,
  onTrackAll,
  saveDisplayMode,
  saveTrackDefault,
  saveTrackMine,
  setTrackAll,
  type DisplayMode,
  type TrackChoice,
} from "./review";
import type { DrawingData } from "./DrawingDialog";

// Excalidraw is heavy, so the drawing editor loads only when first opened.
const DrawingDialog = lazy(() =>
  import("./DrawingDialog").then((m) => ({ default: m.DrawingDialog })),
);
import { Comments, type CommentsHandle } from "./Comments";
import { EditorContextMenu } from "./EditorContextMenu";
import { EquationEditor } from "./math/EquationEditor";
import { setMathEditHandler } from "./math/MathNode";
import { ReferenceDialogs, openReferenceDialog } from "./ReferenceDialogs";
import { InsertDialogs, openInsertDialog, pickTextFromFile } from "./InsertDialogs";
import { ProofingDialogs, openProofingDialog } from "./SpellMenu";
import { toggleDarkDocument, useDarkDocument } from "./viewModes";
import { ApiConsole } from "./api/ApiConsole";
import { scriptingEnabled } from "./api/flag";
import { spellService } from "../../lib/spell/service";
import { CompareDialog, openCompareDialog } from "./CompareDialog";
import { MailMerge, openMailMerge } from "./MailMergePanel";
import { FillFormBar, FormsUI, useProtectionMode } from "./FormsUI";
import { insertTableOfContents, toggleFieldCodes, updateFields } from "./references";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { schemeActionFor } from "./shortcuts";
import { getShortcutScheme } from "../../lib/shortcutScheme";
import { FindBar, type FindMode } from "./FindBar";
import { AutoCorrectDialog } from "./AutoCorrectDialog";
import { getAutoCorrect, loadAutoCorrect, saveAutoCorrect } from "./autocorrect";
import { promptLink } from "./links";

interface DocEditorProps {
  user: User;
}

export function DocEditor({ user }: DocEditorProps) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Untitled document");
  const [starred, setStarred] = useState(false);
  // The ruler's first-line indent (a page-wide default); the margins come
  // from the section at the caret (M9).
  const [firstLine, setFirstLine] = useState(0);
  const [mode, setMode] = useState<EditorMode>("editing");
  const [showPageNumbers, setShowPageNumbers] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showPages, setShowPages] = useState(false);
  const [printPreview, setPrintPreview] = useState(false);
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
    | "shortcuts"
    | "spacing"
    | "autocorrect"
  >(null);
  // Find & replace bar (Ctrl+F / Ctrl+H); findFocus refocuses it.
  const [findBar, setFindBar] = useState<FindMode | null>(null);
  const [findFocus, setFindFocus] = useState(0);
  const openFind = (m: FindMode) => {
    setFindBar((cur) => (m === "find" && cur === "replace" ? cur : m));
    setFindFocus((n) => n + 1);
  };
  // Right-hand side panel: version history, comments, or suggestions.
  const [panel, setPanel] = useState<
    null | "versions" | "comments" | "suggestions" | "table" | "object"
  >(null);
  useEffect(() => onOpenTableSettings(() => setPanel("table")), []);
  // Pictures, shapes and charts (M7): their settings panel.
  useEffect(() => onOpenObjectSettings(() => setPanel("object")), []);
  // Track changes (M5): my choice for this doc, the doc-wide setting (a Yjs
  // map, set below once collab exists) and my default; the newest wins.
  const [trackMine, setTrackMine] = useState<TrackChoice | null>(() => loadTrackMine(user.id, id));
  const [trackEveryone, setTrackEveryone] = useState<TrackChoice | null>(null);
  const [trackDefault, setTrackDefaultState] = useState(() => loadTrackDefault(user.id));
  const suggesting = effectiveTracking(trackMine, trackEveryone, trackDefault);
  const [display, setDisplayState] = useState<DisplayMode>(() => loadDisplayMode(user.id));
  const setDisplay = (m: DisplayMode) => {
    setDisplayState(m);
    saveDisplayMode(user.id, m);
  };
  // Header/footer editors, for the review panel and popover.
  const [headerEditor, setHeaderEditor] = useState<Editor | null>(null);
  const [footerEditor, setFooterEditor] = useState<Editor | null>(null);
  // The command palette's list is memoised, so its actions read these.
  const liveReview = useRef({ suggesting, margins: [] as (Editor | null)[] });
  liveReview.current = { suggesting, margins: [headerEditor, footerEditor] };
  // Drawing editor: open + the scene being edited + the node pos (null = new).
  const [drawing, setDrawing] = useState<{
    open: boolean;
    scene?: string;
    pos: number | null;
  }>({ open: false, pos: null });
  // Equation panel: the math node being edited (M11).
  const [mathEdit, setMathEdit] = useState<{ pos: number; isNew: boolean } | null>(null);
  // Left-hand outline (table of contents) pane.
  const [showOutline, setShowOutline] = useState(false);
  // Header/footer margin regions (bound to named Yjs fragments).
  const [showHeaderFooter, setShowHeaderFooter] = useState(false);

  const collab = useMemo(() => createCollab(id), [id]);
  useEffect(() => () => collab.destroy(), [collab]);

  useEffect(() => {
    setTrackEveryone(getTrackAll(collab.ydoc));
    return onTrackAll(collab.ydoc, setTrackEveryone);
  }, [collab]);
  const setMine = (on: boolean) => {
    const c = { on, at: Date.now() };
    setTrackMine(c);
    saveTrackMine(user.id, id, c);
    if (on) {
      setMode("editing");
      setPanel("suggestions");
    }
  };
  const track: TrackControls = {
    tracking: suggesting,
    everyone: governingEveryone(trackMine, trackEveryone),
    byDefault: trackDefault,
    setMine,
    setEveryone: (on) => {
      setTrackAll(collab.ydoc, on);
      if (on) setMode("editing");
    },
    setDefault: (on) => {
      setTrackDefaultState(on);
      saveTrackDefault(user.id, on);
    },
  };

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

  const reviewUser = useMemo(
    () => ({ name: user.display_name || user.email, color: colorFor(user.id) }),
    [user.display_name, user.email, user.id],
  );
  const reviewSources = useMemo<ReviewSource[]>(
    () => [
      { label: "Header", editor: headerEditor },
      { label: "Body", editor },
      { label: "Footer", editor: footerEditor },
    ],
    [editor, headerEditor, footerEditor],
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

  // Document protection (M10): read-only and comments-only documents
  // aren't editable.
  const protMode = useProtectionMode(editor);

  // Editing vs Viewing mode: actually toggle ProseMirror editability.
  useEffect(() => {
    editor?.setEditable(mode === "editing" && protMode !== "readOnly" && protMode !== "comments");
  }, [editor, mode, protMode]);

  // The user's AutoCorrect settings (stored per user in this browser).
  useEffect(() => {
    editor?.commands.setAutoCorrect(loadAutoCorrect(user.id));
  }, [editor, user.id]);

  // Mirror the Suggesting toggle into the editor's suggestion plugin storage.
  useEffect(() => {
    editor?.commands.setSuggesting(suggesting);
  }, [editor, suggesting]);

  // Page numbers for fields come from the pagination plugin (M9); the
  // page-number labels and the status bar read the same layout.
  const pg = usePagination(editor);
  // View ▸ Dark document (M13) and the scripting API's header/footer parts.
  const darkDoc = useDarkDocument();
  const apiParts = useCallback(() => [headerEditor, footerEditor].filter((x): x is NonNullable<typeof x> => !!x), [headerEditor, footerEditor]);

  // "Insert page numbers" reveals the headers and footers.
  useEffect(() => {
    const on = () => setShowHeaderFooter(true);
    window.addEventListener("grown-docs-show-hf", on);
    return () => window.removeEventListener("grown-docs-show-hf", on);
  }, []);

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

  // Downloads include this document's comment threads.
  useEffect(() => {
    if (editor) setExportDocId(editor, id);
  }, [editor, id]);

  // Seed content when arriving from "Make a copy", a template or an import.
  // A directly imported .docx carries the whole model (styles, lists,
  // header/footer, comments), not just HTML.
  useEffect(() => {
    if (!editor) return;
    if (!hasDocxSeed(id) && sessionStorage.getItem(`docseed:${id}`) === null) return;
    // The seed is applied only once the collab socket has synced (the
    // server's replay has arrived). The hub never asks a client for state it
    // made before connecting, so content set before the sync never reached
    // the server: the new document looked right and reloaded empty (seen
    // arriving from Drive's Open in Docs, whose first editor is also rebuilt
    // with its collab session before its socket opens).
    // Only a live, empty editor takes the seed: after an in-app navigation
    // this effect first runs with the previous document's editor (M12
    // results), and a destroyed editor must not swallow the seed meant for
    // its successor.
    const provider = collab.provider;
    let live = true;
    const usable = () => live && !editor.isDestroyed && editor.getText().trim() === "";
    const apply = () => {
      if (!usable()) return;
      if (hasDocxSeed(id)) {
        void import("./docx/apply").then(async ({ applyDocxImport, importComments }) => {
          if (!usable()) return;
          const docx = takeDocxSeed(id);
          if (!docx) return;
          applyDocxImport(editor, docx);
          if (!docx.comments.length) return;
          await importComments(
            editor,
            docx.comments,
            {
              add: (body, quote, from, to) => addComment(id, body, quote, from, to),
              reply: (parent, body) => replyToComment(id, parent, body),
              resolve: (cid) => resolveComment(id, cid),
            },
            user.display_name || user.email,
          );
        });
        return;
      }
      const seed = sessionStorage.getItem(`docseed:${id}`);
      if (seed === null) return;
      sessionStorage.removeItem(`docseed:${id}`);
      editor.commands.setContent(seed);
    };
    const onSync = (synced: boolean) => {
      if (!synced) return;
      provider.off("sync", onSync);
      apply();
    };
    if (provider.synced) apply();
    else provider.on("sync", onSync);
    return () => {
      live = false;
      provider.off("sync", onSync);
    };
  }, [editor, id, collab]);

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
    // Word count opens the document statistics (M13).
    wordCount: () => openInsertDialog("stats"),
    findReplace: () => openFind("replace"),
    find: () => openFind("find"),
    autoCorrect: () => setDialog("autocorrect"),
    customSpacing: () => setDialog("spacing"),
    emoji: () => setDialog("emoji"),
    specialChars: () => setDialog("specials"),
    pageSetup: () => openLayoutDialog("pagesetup"),
    printPreview: () => setPrintPreview(true),
    togglePageThumbnails: () => setShowPages((s) => !s),
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
    insertEndnote: () => editor?.chain().focus().insertEndnote().run(),
    toggleHeaderFooter: () => setShowHeaderFooter((s) => !s),
    toggleSuggesting: () => {
      const on = liveReview.current.suggesting;
      setMine(!on);
      if (on) setPanel(null);
    },
    reviewPanel: () => setPanel("suggestions"),
    trackForEveryone: (on: boolean) => track.setEveryone(on),
    setDisplayMode: (m: DisplayMode) => setDisplay(m),
    nextChange: () => editor?.chain().focus().nextChange().run(),
    previousChange: () => editor?.chain().focus().previousChange().run(),
    acceptCurrentChange: () => editor?.chain().focus().acceptCurrentChange().run(),
    rejectCurrentChange: () => editor?.chain().focus().rejectCurrentChange().run(),
    acceptAllChanges: () => {
      for (const e of [editor, ...liveReview.current.margins]) e?.commands.acceptAllSuggestions();
    },
    rejectAllChanges: () => {
      for (const e of [editor, ...liveReview.current.margins]) e?.commands.rejectAllSuggestions();
    },
    insertDrawing: () => setDrawing({ open: true, pos: null }),
    insertEquation: () => editor?.chain().focus().insertEquation().run(),
  };

  function onDrawingSave(d: DrawingData) {
    if (!editor) return;
    if (drawing.pos == null) {
      editor.chain().focus().insertDrawing(d).run();
    } else {
      editor.chain().focus().updateDrawing(drawing.pos, d).run();
    }
    setDrawing({ open: false, pos: null });
  }

  // Pictures go to this document's asset store (M7).
  useEffect(() => {
    if (!editor) return;
    setAssetDoc(editor.view, id);
    return () => setAssetDoc(editor.view, null);
  }, [editor, id]);

  // Clicking an equation (or inserting one) opens the equation panel.
  useEffect(() => {
    if (!editor) return;
    setMathEditHandler(editor, (pos, isNew) => setMathEdit({ pos, isNew }));
    return () => setMathEditHandler(editor, null);
  }, [editor]);

  // Double-click a drawing image to re-open it in the Excalidraw editor.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onDbl = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const img = target?.closest?.("img.doc-drawing") as HTMLElement | null;
      if (!img) return;
      e.preventDefault();
      try {
        const pos = editor.view.posAtDOM(img, 0);
        const node = editor.state.doc.nodeAt(pos);
        if (node && node.type.name === "drawing") {
          setDrawing({
            open: true,
            scene: node.attrs.scene as string,
            pos,
          });
        }
      } catch {
        /* ignore */
      }
    };
    dom.addEventListener("dblclick", onDbl);
    return () => dom.removeEventListener("dblclick", onDbl);
  }, [editor]);

  // Global editor shortcuts not handled by TipTap: command palette (Alt+/),
  // keyboard-shortcuts overlay (Ctrl+/), comment (Ctrl+Alt+M), version
  // history (Ctrl+Alt+Shift+H), find & replace (Ctrl+H), link (Ctrl+K),
  // spelling and word count (their chords depend on the shortcut scheme).
  // Editing shortcuts live in shortcuts.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setPrintPreview(true);
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "/") {
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
      } else if (schemeActionFor(getShortcutScheme("docs"), e) === "spelling") {
        // Spelling (M13): F7 (Office) or Ctrl+Alt+X (Google).
        e.preventDefault();
        openProofingDialog("spelling");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.altKey &&
        e.shiftKey &&
        (e.key === "h" || e.key === "H")
      ) {
        e.preventDefault();
        setPanel("versions");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "h" || e.key === "H")
      ) {
        e.preventDefault();
        actions.findReplace();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "f" || e.key === "F")
      ) {
        e.preventDefault();
        openFind("find");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "k" || e.key === "K") &&
        editor?.isFocused
      ) {
        e.preventDefault();
        promptLink(editor);
      } else if (schemeActionFor(getShortcutScheme("docs"), e) === "wordCount") {
        // Ctrl+Shift+C (both schemes), Ctrl+Shift+G (Office).
        e.preventDefault();
        actions.wordCount();
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
      { label: "Table settings", section: "Format", run: () => openTableSettings() },
      { label: "Convert text to table", section: "Format", run: () => openConvertTextDialog() },
      { label: "Convert table to text", section: "Format", run: () => tableToText(e) },
      { label: "Split table", section: "Format", run: () => splitTable(e) },
      { label: "Distribute rows", section: "Format", run: () => distributeRows(e) },
      { label: "Distribute columns", section: "Format", run: () => distributeColumns(e) },
      { label: "Repeat header row", section: "Format", run: () => toggleRepeatHeader(e) },
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
      { label: "Drawing", section: "Insert", run: actions.insertDrawing },
      { label: "Image from file", section: "Insert", run: () => openInsertObject("picture") },
      { label: "Image by URL", section: "Insert", run: () => openInsertObject("pictureUrl") },
      { label: "Shape", section: "Insert", run: () => openInsertObject("shape") },
      { label: "Text box", section: "Insert", run: () => openInsertObject("textBox") },
      { label: "Chart", section: "Insert", run: () => openInsertObject("chart") },
      { label: "Image settings", section: "Format", run: () => openObjectSettings() },
      { label: "Equation", section: "Insert", run: () => e.chain().focus().insertEquation().run() },
      { label: "Insert emoji", section: "Insert", run: actions.emoji },
      { label: "Table of contents", section: "Insert", run: () => insertTableOfContents(e) },
      { label: "Table of figures", section: "Insert", run: () => openReferenceDialog("tof") },
      { label: "Caption", section: "Insert", run: () => openReferenceDialog("caption") },
      { label: "Cross-reference", section: "Insert", run: () => openReferenceDialog("crossref") },
      { label: "Bookmark", section: "Insert", run: () => openReferenceDialog("bookmarks") },
      { label: "Link settings", section: "Insert", run: () => openReferenceDialog("hyperlink") },
      { label: "Page number", section: "Insert", run: () => e.chain().focus().insertField("PAGE").run() },
      { label: "Date and time field", section: "Insert", run: () => openReferenceDialog("field") },
      { label: "Update fields", section: "Tools", run: () => updateFields(e, "selection") },
      { label: "Update all fields", section: "Tools", run: () => updateFields(e, "all") },
      { label: "Show field codes", section: "View", run: () => toggleFieldCodes(e) },
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
      { label: "Find", section: "Edit", run: () => openFind("find") },
      { label: "Find and replace", section: "Edit", run: actions.findReplace },
      { label: "AutoCorrect options", section: "Tools", run: () => setDialog("autocorrect") },
      { label: "Download", section: "File", run: actions.download },
      { label: "Share", section: "File", run: actions.share },
      { label: "Make a copy", section: "File", run: actions.makeCopy },
      { label: "Print", section: "File", run: () => setPrintPreview(true) },
      { label: "Print preview", section: "File", run: () => setPrintPreview(true) },
      { label: "Page setup", section: "Layout", run: () => openLayoutDialog("pagesetup") },
      { label: "Columns", section: "Layout", run: () => openLayoutDialog("columns") },
      { label: "Section break (next page)", section: "Layout", run: () => e.chain().focus().insertSectionBreak("nextPage").run() },
      { label: "Section break (continuous)", section: "Layout", run: () => e.chain().focus().insertSectionBreak("continuous").run() },
      { label: "Column break", section: "Layout", run: () => e.chain().focus().insertColumnBreak().run() },
      { label: "Watermark", section: "Layout", run: () => openLayoutDialog("watermark") },
      { label: "Line numbers", section: "Layout", run: () => openLayoutDialog("linenumbers") },
      { label: "Hyphenation", section: "Layout", run: () => openLayoutDialog("hyphenation") },
      { label: "Header & footer options", section: "Layout", run: () => openLayoutDialog("headerfooter") },
      { label: "Page numbers", section: "Insert", run: () => openLayoutDialog("pagenumbers") },
      { label: "Page thumbnails", section: "View", run: () => setShowPages((v) => !v) },
      { label: "Word count", section: "Tools", run: actions.wordCount },
      // M13: proofing, symbols, view toggles.
      { label: "Spelling and grammar", section: "Tools", run: () => openProofingDialog("spelling") },
      { label: "Check spelling as you type", section: "Tools", run: () => e.commands.setSpellcheck(!spellService().enabled) },
      { label: "Language", section: "Tools", run: () => openProofingDialog("language") },
      { label: "Document statistics", section: "Tools", run: () => openInsertDialog("stats") },
      { label: "Symbol", section: "Insert", run: () => openInsertDialog("symbol") },
      { label: "Date and time", section: "Insert", run: () => openInsertDialog("datetime") },
      { label: "Drop cap", section: "Insert", run: () => openInsertDialog("dropcap") },
      { label: "Text from file", section: "Insert", run: () => pickTextFromFile(e) },
      { label: "Show non-printing characters", section: "View", run: () => e.chain().focus().toggleNonPrinting().run() },
      { label: "Dark document", section: "View", run: () => toggleDarkDocument() },
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
      { label: "Track changes on for everyone", section: "Tools", run: () => actions.trackForEveryone?.(true) },
      { label: "Track changes off for everyone", section: "Tools", run: () => actions.trackForEveryone?.(false) },
      { label: "Review changes", section: "Tools", run: () => actions.reviewPanel?.() },
      { label: "Compare documents", section: "Tools", run: () => openCompareDialog("compare") },
      { label: "Combine documents", section: "Tools", run: () => openCompareDialog("combine") },
      { label: "Mail merge", section: "Tools", run: () => openMailMerge() },
      { label: "Next change", section: "Tools", run: () => actions.nextChange?.() },
      { label: "Previous change", section: "Tools", run: () => actions.previousChange?.() },
      { label: "Accept current change", section: "Tools", run: () => actions.acceptCurrentChange?.() },
      { label: "Reject current change", section: "Tools", run: () => actions.rejectCurrentChange?.() },
      { label: "Accept all changes", section: "Tools", run: () => actions.acceptAllChanges?.() },
      { label: "Reject all changes", section: "Tools", run: () => actions.rejectAllChanges?.() },
      { label: "Display: Markup", section: "View", run: () => actions.setDisplayMode?.("markup") },
      { label: "Display: Simple markup", section: "View", run: () => actions.setDisplayMode?.("simple") },
      { label: "Display: Final", section: "View", run: () => actions.setDisplayMode?.("final") },
      { label: "Display: Original", section: "View", run: () => actions.setDisplayMode?.("original") },
      {
        label: "Comment on selection",
        section: "Insert",
        run: actions.commentOnSelection,
      },
      { label: "Keyboard shortcuts", section: "Help", run: actions.shortcuts },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, title]);

  // Page geometry: the section at the caret drives the ruler; the first
  // section the pageless sheet; the layout the paginated view.
  const secProps = editor && !editor.isDestroyed ? currentSection(editor).props : (pg?.settings.section ?? null) ?? {
    pageW: 612, pageH: 792, orient: "portrait" as const, margins: { top: 72, bottom: 72, left: 72, right: 72, header: 36, footer: 36, gutter: 0 },
  };
  const indents: Indents = { left: secProps.margins.left / 72, right: secProps.margins.right / 72, firstLine };
  const vMargins = { top: secProps.margins.top / 72, bottom: secProps.margins.bottom / 72 };
  const pageBox = { w: ptToPx(secProps.pageW), h: ptToPx(secProps.pageH), hyphenation: pg?.settings.hyphenation };
  const paged = pg && pg.paged && pg.dl && pg.base ? { dl: pg.dl, base: pg.base } : null;

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
          onInsertEquation={actions.insertEquation}
          mode={mode === "editing" && suggesting ? "suggesting" : mode}
          onModeChange={(m) => {
            if (m === "suggesting") setMine(true);
            else {
              if (suggesting) setMine(false);
              setMode(m);
            }
          }}
        />
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <Ruler
            indents={indents}
            pageInches={secProps.pageW / 72}
            onChange={(next) => {
              setFirstLine(next.firstLine);
              if (editor && (Math.abs(next.left - indents.left) > 1e-6 || Math.abs(next.right - indents.right) > 1e-6))
                setSectionProps(editor, (p) => ({ ...p, margins: { ...p.margins, left: next.left * 72, right: next.right * 72 } }));
            }}
            paragraph={editor ? selectedParagraphIndents(editor) : null}
            onParagraphChange={(p) =>
              editor?.chain().setIndents({ left: p.left, right: p.right, firstLine: p.firstLine }).run()
            }
          />
        </Box>
        <FillFormBar editor={editor} title={title} />
      </Container>

      <Box sx={{ display: "flex", alignItems: "stretch", minHeight: "70vh" }}>
        {showOutline && (
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <Outline editor={editor} onClose={() => setShowOutline(false)} />
          </Box>
        )}
        {showPages && editor && (
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <PageThumbnails editor={editor} dl={pg?.dl ?? null} onClose={() => setShowPages(false)} />
          </Box>
        )}
        <Box sx={{ ...workspaceSx, flex: 1, minWidth: 0 }}>
          <Box sx={zoom !== 100 ? { zoom: zoom / 100 } : undefined} data-zoom={zoom}>
          <Sheet
            ref={pageRef}
            variant="plain"
            sx={
              paged
                ? { ...editorPageSx(indents, secProps.orient, vMargins, pageBox), ...pagedSheetSx(paged.base, paged.dl.layout.height, pg?.settings.hyphenation) }
                : editorPageSx(indents, secProps.orient, vMargins, pageBox)
            }
            data-testid="doc-editor"
            data-paged={paged ? "true" : "false"}
            lang="en"
            className={`review-${display}${darkDoc ? " doc-dark" : ""}`}
          >
            {paged && <PageBackground dl={paged.dl} base={paged.base} />}
            {!paged && showHeaderFooter && (
              <Box className="doc-header-region">
                <MarginEditor
                  ydoc={collab.ydoc}
                  field="header"
                  editable={mode === "editing"}
                  placeholder="Header"
                  suggesting={suggesting}
                  user={reviewUser}
                  onEditor={setHeaderEditor}
                />
              </Box>
            )}
            <EditorContent editor={editor} />
            {!paged && <Footnotes editor={editor} />}
            {!paged && <Endnotes editor={editor} />}
            {!paged && showHeaderFooter && (
              <Box className="doc-footer-region">
                <MarginEditor
                  ydoc={collab.ydoc}
                  field="footer"
                  editable={mode === "editing"}
                  placeholder="Footer"
                  suggesting={suggesting}
                  user={reviewUser}
                  onEditor={setFooterEditor}
                />
              </Box>
            )}
            {paged && editor && (
              <PageHeadersFooters
                editor={editor}
                ydoc={collab.ydoc}
                dl={paged.dl}
                base={paged.base}
                editable={mode === "editing"}
                showHeaderFooter={showHeaderFooter}
                onShowHeaderFooter={() => setShowHeaderFooter(true)}
                showPageNumbers={showPageNumbers}
                suggesting={suggesting}
                user={reviewUser}
                onHeaderEditor={setHeaderEditor}
                onFooterEditor={setFooterEditor}
              />
            )}
            <ReviewPopover sources={reviewSources} container={pageRef} hidden={display !== "markup"} />
            {!paged &&
              showPageNumbers &&
              Array.from({ length: pg?.dl?.layout.pages.length ?? 1 }, (_, i) => (
                <Box
                  key={i}
                  sx={{
                    position: "absolute",
                    right: 24,
                    top: `${(i + 1) * ptToPx(secProps.pageH) - 30}px`,
                    fontSize: 11,
                    color: "#80868b",
                    pointerEvents: "none",
                  }}
                >
                  {i + 1}
                </Box>
              ))}
          </Sheet>
          {paged && (
            <Box
              sx={{
                width: `${Math.min(paged.base.maxW, 816)}px`,
                maxWidth: "100%",
                mx: "auto",
                mt: 2,
                bgcolor: "#fff",
                px: { xs: 2, md: `${paged.base.left - (paged.base.maxW - Math.min(paged.base.maxW, 816)) / 2}px` },
                "&:empty": { display: "none" },
                "& .ProseMirror": { outline: "none" },
              }}
              className="doc-notes"
            >
              <Footnotes editor={editor} />
              <Endnotes editor={editor} />
            </Box>
          )}
          </Box>
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
                userName={user.display_name || user.email}
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
        {panel === "table" && (
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
                position: { xs: "fixed", md: "sticky" },
                top: { xs: 0, md: 8 },
                right: { xs: 0, md: "auto" },
                bottom: { xs: 0, md: "auto" },
                alignSelf: "flex-start",
                zIndex: { xs: 1201, md: 1 },
                width: { xs: "min(320px, 100vw)", md: "auto" },
                height: { xs: "100vh", md: "auto" },
                overflowY: { xs: "auto", md: "visible" },
              }}
            >
              <TableSettings editor={editor} onClose={() => setPanel(null)} />
            </Box>
          </>
        )}
        {panel === "object" && (
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
                position: { xs: "fixed", md: "sticky" },
                top: { xs: 0, md: 8 },
                right: { xs: 0, md: "auto" },
                bottom: { xs: 0, md: "auto" },
                alignSelf: "flex-start",
                zIndex: { xs: 1201, md: 1 },
                width: { xs: "min(320px, 100vw)", md: "auto" },
                height: { xs: "100vh", md: "auto" },
                overflowY: { xs: "auto", md: "visible" },
              }}
            >
              <ObjectSettings editor={editor} onClose={() => setPanel(null)} />
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
              <Suggestions
                sources={reviewSources}
                track={track}
                display={display}
                onDisplay={setDisplay}
                onClose={() => setPanel(null)}
              />
            </Box>
          </>
        )}
      </Box>

      <StatusBar editor={editor} state={pg} zoom={zoom} onZoom={setZoom} onShowPages={() => setShowPages((v) => !v)} />

      <EditorContextMenu
        editor={editor}
        onComment={() => actions.commentOnSelection()}
        onEditEquation={(pos) => setMathEdit({ pos, isNew: false })}
      />
      <ParagraphDialogs editor={editor} />
      <TableDialogs editor={editor} />
      <ReferenceDialogs editor={editor} />
      <InsertDialogs editor={editor} />
      <ProofingDialogs editor={editor} />
      {scriptingEnabled() && <ApiConsole editor={editor} parts={apiParts} />}
      <CompareDialog editor={editor} docId={id} title={title} userName={user.display_name || user.email} />
      <MailMerge editor={editor} title={title} />
      <FormsUI editor={editor} docId={id} title={title} />
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
      <CustomSpacingDialog
        open={dialog === "spacing"}
        onClose={() => setDialog(null)}
        editor={editor}
      />
      {findBar && (
        <FindBar
          editor={editor}
          mode={findBar}
          onModeChange={setFindBar}
          onClose={() => setFindBar(null)}
          focusKey={findFocus}
        />
      )}
      {editor && (
        <AutoCorrectDialog
          open={dialog === "autocorrect"}
          onClose={() => setDialog(null)}
          settings={getAutoCorrect(editor)}
          onSave={(s) => {
            editor.commands.setAutoCorrect(s);
            saveAutoCorrect(user.id, s);
          }}
        />
      )}
      <LayoutDialogs editor={editor} ydoc={collab.ydoc} />
      <PrintPreview editor={editor} sheetRef={pageRef} open={printPreview} onClose={() => setPrintPreview(false)} />
      <CommandPalette
        open={dialog === "menus"}
        onClose={() => setDialog(null)}
        commands={commands}
      />
      {editor && mathEdit && (
        <EquationEditor
          key={`${mathEdit.pos}-${mathEdit.isNew}`}
          editor={editor}
          pos={mathEdit.pos}
          isNew={mathEdit.isNew}
          onClose={() => setMathEdit(null)}
        />
      )}
      <ObjectDialogs editor={editor} />
      {drawing.open && (
        <Suspense fallback={null}>
          <DrawingDialog
            open={drawing.open}
            initialScene={drawing.scene}
            onClose={() => setDrawing({ open: false, pos: null })}
            onSave={onDrawingSave}
          />
        </Suspense>
      )}
    </>
  );
}
