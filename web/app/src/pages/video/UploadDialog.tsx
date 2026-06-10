import { useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  Textarea,
  FormControl,
  FormLabel,
  LinearProgress,
  Sheet,
  AspectRatio,
} from "@mui/joy";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import MovieIcon from "@mui/icons-material/Movie";
import { uploadVideo } from "./api";
import { probeVideo, formatBytes, formatDuration } from "./media";
import type { Video } from "./types";

interface UploadDialogProps {
  onClose: () => void;
  onUploaded: (v: Video) => void;
}

/** UploadDialog: pick a video file, auto-extract a poster + duration client-side,
 *  edit title/description, then upload with a progress bar. */
export function UploadDialog({ onClose, onUploaded }: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumb, setThumb] = useState("");
  const [duration, setDuration] = useState(0);
  const [probing, setProbing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(f: File) {
    setError(null);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    setProbing(true);
    try {
      const p = await probeVideo(f);
      setThumb(p.thumbnailDataUrl);
      setDuration(p.durationSeconds);
    } finally {
      setProbing(false);
    }
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const v = await uploadVideo(
        file,
        {
          title: title.trim() || file.name,
          description: description.trim(),
          duration_seconds: duration,
          thumbnail_data_url: thumb,
        },
        (frac) => setProgress(frac),
      );
      onUploaded(v);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <Modal open onClose={uploading ? undefined : onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 520 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        {!uploading && <ModalClose />}
        <Typography level="h4">Upload video</Typography>

        {!file ? (
          <Sheet
            variant="soft"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) pick(f);
            }}
            sx={{
              mt: 2,
              p: 4,
              borderRadius: "md",
              textAlign: "center",
              cursor: "pointer",
              border: "2px dashed",
              borderColor: dragging
                ? "primary.outlinedBorder"
                : "neutral.outlinedBorder",
              bgcolor: dragging ? "primary.softBg" : undefined,
            }}
          >
            <UploadFileIcon sx={{ fontSize: 40, opacity: 0.6 }} />
            <Typography level="body-md" sx={{ mt: 1 }}>
              Drag a video here, or click to choose a file
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.6, mt: 0.5 }}>
              MP4, WebM, MOV, MKV…
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick(f);
              }}
            />
          </Sheet>
        ) : (
          <Box
            sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1.5 }}
          >
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <AspectRatio
                ratio="16/9"
                sx={{ width: 160, borderRadius: "sm", flexShrink: 0 }}
              >
                {thumb ? (
                  <img src={thumb} alt="poster preview" />
                ) : (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "neutral.softBg",
                    }}
                  >
                    <MovieIcon sx={{ opacity: 0.5 }} />
                  </Box>
                )}
              </AspectRatio>
              <Box sx={{ minWidth: 0 }}>
                <Typography level="body-sm" noWrap>
                  {file.name}
                </Typography>
                <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                  {formatBytes(file.size)}
                  {duration > 0
                    ? ` · ${formatDuration(duration)}`
                    : probing
                      ? " · reading…"
                      : ""}
                </Typography>
                {!uploading && (
                  <Button
                    size="sm"
                    variant="plain"
                    sx={{ mt: 0.5, px: 0 }}
                    onClick={() => {
                      setFile(null);
                      setThumb("");
                      setDuration(0);
                    }}
                  >
                    Choose a different file
                  </Button>
                )}
              </Box>
            </Box>

            <FormControl>
              <FormLabel>Title</FormLabel>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={uploading}
                placeholder="Title"
              />
            </FormControl>
            <FormControl>
              <FormLabel>Description</FormLabel>
              <Textarea
                minRows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={uploading}
                placeholder="Optional"
              />
            </FormControl>

            {uploading && (
              <Box>
                <LinearProgress
                  determinate
                  value={Math.round((progress ?? 0) * 100)}
                />
                <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.7 }}>
                  Uploading… {Math.round((progress ?? 0) * 100)}%
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {error && (
          <Typography color="danger" level="body-sm" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}

        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button
            variant="plain"
            color="neutral"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!file || probing}
            loading={uploading}
            startDecorator={<UploadFileIcon />}
          >
            Upload
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
