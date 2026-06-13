import { Box, Button, Typography } from "@mui/joy";
import { PdfPreview } from "./PdfPreview";
import { CsvPreview } from "./CsvPreview";
import { ImageMetadata } from "./ImageMetadata";
import type { DriveFile } from "./types";
import { downloadURL } from "./api";
import { isModelFile } from "../3d/formats";
import { ModelPreview } from "../3d/ModelPreview";

interface FilePreviewProps {
  file: DriveFile;
}

/**
 * FilePreview is the shared mime-type-dispatching preview content. Used by
 * both the generic FileViewer (at /drive/file/:id) and by per-type editor
 * placeholder pages (at /sheets/:id, /pdf/:id, etc.).
 */
export function FilePreview({ file }: FilePreviewProps) {
  const url = downloadURL(file.id);
  const m = file.mime_type;

  // 3D models are matched by extension (most are stored as octet-stream) and
  // get a dedicated interactive preview with an "Open in 3D" handoff.
  if (isModelFile(file.name)) {
    return (
      <Box
        sx={{ bgcolor: "background.level1", borderRadius: "md", minHeight: 400 }}
      >
        <ModelPreview file={file} />
      </Box>
    );
  }

  return (
    <Box
      sx={{ bgcolor: "background.level1", borderRadius: "md", minHeight: 400 }}
    >
      {m === "application/pdf" && <PdfPreview url={url} />}
      {m.startsWith("image/") && (
        <>
          <img
            src={url}
            alt={file.name}
            style={{ maxWidth: "100%", display: "block", margin: "0 auto" }}
          />
          <ImageMetadata url={url} />
        </>
      )}
      {m.startsWith("video/") && (
        <video
          src={url}
          controls
          style={{ width: "100%", maxHeight: "80vh" }}
        />
      )}
      {m.startsWith("audio/") && (
        <audio src={url} controls style={{ width: "100%", padding: 16 }} />
      )}
      {m === "text/csv" && <CsvPreview url={url} />}
      {m !== "text/csv" &&
        (m.startsWith("text/") || m === "application/json") && (
          <iframe
            src={url}
            title={file.name}
            style={{ width: "100%", height: "80vh", border: 0 }}
          />
        )}
      {!m.startsWith("image/") &&
        !m.startsWith("video/") &&
        !m.startsWith("audio/") &&
        !m.startsWith("text/") &&
        m !== "application/pdf" &&
        m !== "application/json" && (
          <Box sx={{ p: 6, textAlign: "center" }}>
            <Typography level="body-md">
              No preview available for this file type.
            </Typography>
            <Button
              sx={{ mt: 2 }}
              component="a"
              href={url}
              download={file.name}
              variant="solid"
            >
              Download {file.name}
            </Button>
          </Box>
        )}
    </Box>
  );
}
