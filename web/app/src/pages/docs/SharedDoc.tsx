import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Sheet,
  Typography,
  Chip,
  Container,
  CircularProgress,
  Divider,
} from "@mui/joy";
import DescriptionIcon from "@mui/icons-material/Description";
import { useEditor, EditorContent } from "@tiptap/react";
import { getShare, type ShareInfo } from "./api";
import { createCollab, colorFor } from "./collab";
import { buildExtensions } from "./extensions";
import { Toolbar, type EditorMode } from "./Toolbar";
import { Presence } from "./Presence";
import { editorPageSx, workspaceSx } from "./editorStyles";

/** SharedDoc opens a document from a share-link token, with no account required.
 *  Editor-role links are editable; viewer-role links are read-only. */
export default function SharedDoc() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getShare(token)
      .then((i) => !cancelled && setInfo(i))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <Container sx={{ py: 8 }}>
        <Typography level="h3">This link isn’t available</Typography>
        <Typography sx={{ opacity: 0.7 }}>{error}</Typography>
      </Container>
    );
  }
  if (!info) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return <SharedEditor token={token} info={info} />;
}

function SharedEditor({ token, info }: { token: string; info: ShareInfo }) {
  const canEdit = info.role === "editor";
  const [mode, setMode] = useState<EditorMode>(canEdit ? "editing" : "viewing");
  const guestId = useMemo(
    () => "guest-" + Math.floor(performance.now()).toString(36),
    [],
  );
  const collab = useMemo(
    () => createCollab(info.doc_id, token),
    [info.doc_id, token],
  );
  useEffect(() => () => collab.destroy(), [collab]);

  const editor = useEditor(
    {
      editable: canEdit,
      extensions: buildExtensions({
        ydoc: collab.ydoc,
        provider: collab.provider,
        userName: "Guest",
        userColor: colorFor(guestId),
        editable: canEdit,
      }),
    },
    [collab],
  );

  useEffect(() => {
    if (canEdit) editor?.setEditable(mode === "editing");
  }, [editor, mode, canEdit]);

  return (
    <>
      <Sheet
        variant="plain"
        sx={{ px: 2, py: 1, display: "flex", alignItems: "center", gap: 1 }}
      >
        <DescriptionIcon sx={{ color: "#3D5A80", fontSize: 28 }} />
        <Typography level="title-md">{info.title}</Typography>
        <Chip size="sm" variant="soft" color={canEdit ? "primary" : "neutral"}>
          {canEdit ? "Shared · can edit" : "Shared · view only"}
        </Chip>
        <Box sx={{ flex: 1 }} />
        <Presence provider={collab.provider} />
      </Sheet>
      <Divider />
      {canEdit && (
        <Container maxWidth="lg" sx={{ py: 1.5 }}>
          <Toolbar
            editor={editor}
            onOpenMenus={() => {}}
            mode={mode}
            onModeChange={setMode}
          />
        </Container>
      )}
      <Box sx={workspaceSx}>
        <Sheet
          variant="plain"
          sx={editorPageSx({ left: 1, right: 1, firstLine: 0 })}
          data-testid="doc-editor"
        >
          <EditorContent editor={editor} />
        </Sheet>
      </Box>
    </>
  );
}
