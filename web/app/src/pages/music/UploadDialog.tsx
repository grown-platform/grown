import { useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  FormControl,
  FormLabel,
  LinearProgress,
  Sheet,
  AspectRatio,
} from "@mui/joy";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import { uploadTrack } from "./api";
import { probeAudio, formatBytes, formatDuration } from "./media";
import type { Track } from "./types";

interface UploadDialogProps {
  onClose: () => void;
  onUploaded: (t: Track) => void;
}

/** UploadDialog: pick an audio file, auto-read its duration, edit
 *  title/artist/album, then upload with a progress bar. */
export function UploadDialog({ onClose, onUploaded }: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
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
      const p = await probeAudio(f);
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
      const t = await uploadTrack(
        file,
        {
          title: title.trim() || file.name,
          artist: artist.trim(),
          album: album.trim(),
          duration_seconds: duration,
        },
        (frac) => setProgress(frac),
      );
      onUploaded(t);
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
        <Typography level="h4">Upload track</Typography>

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
              Drag an audio file here, or click to choose a file
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.6, mt: 0.5 }}>
              MP3, M4A/AAC, OGG, FLAC, WAV…
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*"
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
                ratio="1"
                sx={{ width: 96, borderRadius: "sm", flexShrink: 0 }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "neutral.softBg",
                  }}
                >
                  <MusicNoteIcon sx={{ opacity: 0.5 }} />
                </Box>
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
            <Box
              sx={{
                display: "flex",
                gap: 1.5,
                flexDirection: { xs: "column", sm: "row" },
              }}
            >
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Artist</FormLabel>
                <Input
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  disabled={uploading}
                  placeholder="Artist"
                />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Album</FormLabel>
                <Input
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  disabled={uploading}
                  placeholder="Album"
                />
              </FormControl>
            </Box>

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
