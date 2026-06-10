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
} from "@mui/joy";
import ImageIcon from "@mui/icons-material/Image";
import { updateBook, uploadCover } from "./api";
import type { Book } from "./types";

interface EditDialogProps {
  book: Book;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/** EditDialog edits a book's metadata and optionally replaces its cover. */
export function EditDialog({ book, onClose, onSaved }: EditDialogProps) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [description, setDescription] = useState(book.description);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      await updateBook(book.id, {
        title: title.trim(),
        author: author.trim(),
        description,
        starred: book.starred,
      });
      if (cover) await uploadCover(book.id, cover);
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog sx={{ width: 480, maxWidth: "95vw" }}>
        <ModalClose disabled={busy} />
        <Typography level="h4">Edit details</Typography>
        <FormControl sx={{ mt: 1, mb: 1 }}>
          <FormLabel>Title</FormLabel>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormControl>
        <FormControl sx={{ mb: 1 }}>
          <FormLabel>Author</FormLabel>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </FormControl>
        <FormControl sx={{ mb: 1 }}>
          <FormLabel>Description</FormLabel>
          <Textarea
            minRows={3}
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
          <FormLabel>Cover image</FormLabel>
          <Button
            variant="outlined"
            color="neutral"
            startDecorator={<ImageIcon />}
            onClick={() => coverRef.current?.click()}
          >
            {cover ? cover.name : "Replace cover image"}
          </Button>
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
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
