import { useRef } from "react";
import { Modal, ModalDialog, ModalClose, Typography, Button, Box } from "@mui/joy";
import { Excalidraw, exportToSvg } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

/* eslint-disable @typescript-eslint/no-explicit-any -- Excalidraw types are heavy; loose typing. */

export interface DrawingData {
  scene: string;
  src: string;
}

interface DrawingDialogProps {
  open: boolean;
  initialScene?: string;
  onClose: () => void;
  onSave: (d: DrawingData) => void;
}

// Embedded Excalidraw editor for inserting/editing a drawing inside a doc.
// Runs entirely client-side — no external service, no sign-in: the user is
// already authenticated to the workspace (Zitadel) and the scene is stored in
// the document. We also strip Excalidraw's collaboration / open-from-disk UI so
// nothing points at an external account.
export function DrawingDialog({
  open,
  initialScene,
  onClose,
  onSave,
}: DrawingDialogProps) {
  const apiRef = useRef<any>(null);

  let initial: any = { elements: [], files: {} };
  try {
    if (initialScene) {
      const p = JSON.parse(initialScene);
      initial = { elements: p.elements || [], files: p.files || {} };
    }
  } catch {
    /* ignore malformed scene */
  }

  const save = async () => {
    const api = apiRef.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const files = api.getFiles();
    let src = "";
    try {
      const svg = await exportToSvg({
        elements,
        appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
        files,
      });
      const svgStr = new XMLSerializer().serializeToString(svg);
      src = "data:image/svg+xml;utf8," + encodeURIComponent(svgStr);
    } catch {
      /* fall back to an empty src if export fails */
    }
    onSave({ scene: JSON.stringify({ elements, files }), src });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: "92vw",
          height: "88vh",
          maxWidth: "92vw",
          p: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ModalClose />
        <Typography level="title-md" sx={{ mb: 0.5 }}>
          Drawing
        </Typography>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {open && (
            <Excalidraw
              excalidrawAPI={(api: any) => (apiRef.current = api)}
              initialData={initial}
              renderTopRightUI={() => null}
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                },
              }}
            />
          )}
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}
        >
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void save();
            }}
          >
            Save
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
