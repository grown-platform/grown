import { useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  Select,
  Option,
  FormControl,
  FormLabel,
  FormHelperText,
  Sheet,
  LinearProgress,
  Textarea,
} from "@mui/joy";
import UploadIcon from "@mui/icons-material/UploadFile";
import ImageIcon from "@mui/icons-material/Image";
import { createBook, uploadBookFile, uploadCover } from "./api";
import type { BookFormat } from "./types";
import { SUPPORTED_FORMATS, extToFormat } from "./types";

interface UploadDialogProps {
  onClose: () => void;
  onDone: () => Promise<void> | void;
}

/** UploadDialog adds a book: pick a file, confirm metadata, optional cover. */
export function UploadDialog({ onClose, onDone }: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [format, setFormat] = useState<BookFormat>("epub");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  function onPickFile(f: File | null) {
    setFile(f);
    if (!f) return;
    const detected = extToFormat(f.name);
    if (detected) setFormat(detected);
    if (!title) {
      const base = f.name
        .replace(/\.[^.]+$/, "")
        .replace(/[._-]+/g, " ")
        .trim();
      setTitle(base);
    }
  }

  async function submit() {
    setError(null);
    if (!file) {
      setError("Choose a book file to upload.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const created = await createBook({
        title: title.trim(),
        author: author.trim(),
        format,
        description,
      });
      await uploadBookFile(created.id, file);
      if (cover) await uploadCover(created.id, cover);
      await onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 520 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose disabled={busy} />
        <Typography level="h4">Upload a book</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
          Supported formats:{" "}
          {SUPPORTED_FORMATS.map((f) => f.toUpperCase()).join(", ")}.
        </Typography>

        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".epub,.pdf,.mobi,.txt,.cbz,application/epub+zip,application/pdf,text/plain"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />
        <Sheet
          variant="soft"
          sx={{
            p: 2,
            borderRadius: "md",
            textAlign: "center",
            cursor: "pointer",
            border: "1px dashed",
            borderColor: "neutral.outlinedBorder",
            mb: 1.5,
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPickFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <UploadIcon sx={{ fontSize: 32, opacity: 0.6 }} />
          <Typography level="body-sm" sx={{ mt: 0.5 }}>
            {file ? file.name : "Click or drop a book file here"}
          </Typography>
        </Sheet>

        <FormControl sx={{ mb: 1 }}>
          <FormLabel>Title</FormLabel>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Book title"
          />
        </FormControl>
        <Box
          sx={{
            display: "flex",
            gap: 1,
            mb: 1,
            flexDirection: { xs: "column", sm: "row" },
          }}
        >
          <FormControl sx={{ flex: 1 }}>
            <FormLabel>Author</FormLabel>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author"
            />
          </FormControl>
          <FormControl sx={{ width: { xs: "100%", sm: 140 } }}>
            <FormLabel>Format</FormLabel>
            <Select value={format} onChange={(_, v) => v && setFormat(v)}>
              {SUPPORTED_FORMATS.map((f) => (
                <Option key={f} value={f}>
                  {f.toUpperCase()}
                </Option>
              ))}
            </Select>
          </FormControl>
        </Box>
        <FormControl sx={{ mb: 1 }}>
          <FormLabel>Description (optional)</FormLabel>
          <Textarea
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormControl>

        <input
          ref={coverRef}
          type="file"
          hidden
          accept="image/*"
          onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        />
        <FormControl>
          <FormLabel>Cover image (optional)</FormLabel>
          <Button
            variant="outlined"
            color="neutral"
            startDecorator={<ImageIcon />}
            onClick={() => coverRef.current?.click()}
          >
            {cover ? cover.name : "Choose cover image"}
          </Button>
          <FormHelperText>
            A cover is auto-derived only for some formats; add one for the best
            library view.
          </FormHelperText>
        </FormControl>

        {error && (
          <Typography color="danger" level="body-sm" sx={{ mt: 1.5 }}>
            {error}
          </Typography>
        )}
        {busy && <LinearProgress sx={{ mt: 1.5 }} />}

        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button
            variant="plain"
            color="neutral"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={submit}
            startDecorator={<UploadIcon />}
          >
            Upload
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
