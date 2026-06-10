import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Sheet,
  AspectRatio,
  Divider,
  LinearProgress,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  IconButton,
} from "@mui/joy";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import DownloadIcon from "@mui/icons-material/Download";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getBook,
  updateBook,
  deleteBook,
  updateProgress,
  coverURL,
  downloadURL,
} from "./api";
import type { Book } from "./types";
import { READABLE_FORMATS } from "./types";
import { EditDialog } from "./EditDialog";

interface DetailProps {
  user: User;
}

export function Detail({ user }: DetailProps) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function reload() {
    try {
      setBook(await getBook(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
  }, [id]);

  if (error) {
    return (
      <>
        <Header user={user} />
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Typography color="danger" role="alert">
            Couldn’t load book: {error}
          </Typography>
          <Button
            sx={{ mt: 2 }}
            variant="soft"
            startDecorator={<ArrowBackIcon />}
            onClick={() => navigate("/books")}
          >
            Back to library
          </Button>
        </Container>
      </>
    );
  }
  if (!book) {
    return (
      <>
        <Header user={user} />
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  const readable = READABLE_FORMATS.includes(book.format);

  async function toggleStar() {
    if (!book) return;
    setBook({ ...book, starred: !book.starred });
    try {
      await updateBook(book.id, {
        title: book.title,
        author: book.author,
        description: book.description,
        starred: !book.starred,
      });
    } catch {
      reload();
    }
  }
  async function toggleFinished() {
    if (!book) return;
    const next = !book.finished;
    setBook({ ...book, finished: next });
    try {
      await updateProgress(book.id, {
        last_location: book.last_location,
        progress_percent: next ? 100 : book.progress_percent,
        finished: next,
      });
    } catch {
      reload();
    }
  }
  async function onDelete() {
    if (!book) return;
    if (
      !window.confirm(
        `Remove “${book.title}” from your library? This deletes the file.`,
      )
    )
      return;
    try {
      await deleteBook(book.id);
      navigate("/books");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Header user={user} />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Button
          variant="plain"
          color="neutral"
          startDecorator={<ArrowBackIcon />}
          onClick={() => navigate("/books")}
          sx={{ mb: 2 }}
        >
          Library
        </Button>
        <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Box sx={{ width: 220, flexShrink: 0 }}>
            <AspectRatio
              ratio="2/3"
              sx={{
                borderRadius: "md",
                boxShadow: "md",
                overflow: "hidden",
                bgcolor: "primary.softBg",
              }}
            >
              {book.has_cover ? (
                <img
                  src={coverURL(book.id)}
                  alt={`Cover of ${book.title}`}
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MenuBookIcon sx={{ fontSize: 64, opacity: 0.4 }} />
                </Box>
              )}
            </AspectRatio>
            {book.progress_percent > 0 && !book.finished && (
              <Box sx={{ mt: 1.5 }}>
                <LinearProgress determinate value={book.progress_percent} />
                <Typography level="body-xs" sx={{ opacity: 0.7, mt: 0.5 }}>
                  {book.progress_percent}% read
                </Typography>
              </Box>
            )}
          </Box>

          <Box sx={{ flex: 1, minWidth: 240 }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <Typography level="h2" sx={{ flex: 1 }}>
                {book.title}
              </Typography>
              <IconButton
                variant="plain"
                onClick={toggleStar}
                aria-label={book.starred ? "Unstar" : "Star"}
              >
                {book.starred ? (
                  <StarIcon sx={{ color: "#f9ab00" }} />
                ) : (
                  <StarBorderIcon />
                )}
              </IconButton>
              <Dropdown>
                <MenuButton
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: {
                      variant: "plain",
                      color: "neutral",
                      "aria-label": "More options",
                    },
                  }}
                >
                  <MoreVertIcon />
                </MenuButton>
                <Menu placement="bottom-end" size="sm">
                  <MenuItem onClick={() => setEditing(true)}>
                    Edit details
                  </MenuItem>
                  <MenuItem onClick={toggleFinished}>
                    {book.finished ? "Mark not finished" : "Mark finished"}
                  </MenuItem>
                  <MenuItem component="a" href={downloadURL(book.id)} download>
                    Export
                  </MenuItem>
                  <ListDivider />
                  <MenuItem color="danger" onClick={onDelete}>
                    Remove from library
                  </MenuItem>
                </Menu>
              </Dropdown>
            </Box>
            <Typography level="title-md" sx={{ opacity: 0.8 }}>
              {book.author || "Unknown author"}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
              <Chip variant="soft">{book.format.toUpperCase()}</Chip>
              {book.size_bytes > 0 && (
                <Chip variant="soft" color="neutral">
                  {formatBytes(book.size_bytes)}
                </Chip>
              )}
              {book.finished && (
                <Chip variant="soft" color="success">
                  Finished
                </Chip>
              )}
            </Box>

            <Box sx={{ display: "flex", gap: 1, mt: 3 }}>
              {readable ? (
                <Button
                  size="lg"
                  startDecorator={<MenuBookIcon />}
                  onClick={() => navigate(`/books/${book.id}/read`)}
                >
                  {book.progress_percent > 0 ? "Continue reading" : "Read"}
                </Button>
              ) : (
                <Typography
                  level="body-sm"
                  sx={{ opacity: 0.7, alignSelf: "center" }}
                >
                  {book.format.toUpperCase()} isn’t previewable in the browser —
                  download to read.
                </Typography>
              )}
              <Button
                size="lg"
                variant="outlined"
                color="neutral"
                startDecorator={<DownloadIcon />}
                component="a"
                href={downloadURL(book.id)}
                download
              >
                Download
              </Button>
            </Box>

            {book.description && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography level="title-sm" sx={{ mb: 1 }}>
                  About this ebook
                </Typography>
                <Typography level="body-md" sx={{ whiteSpace: "pre-wrap" }}>
                  {book.description}
                </Typography>
              </>
            )}
            {!book.file_name && book.size_bytes === 0 && (
              <Sheet
                variant="soft"
                color="warning"
                sx={{ p: 2, mt: 3, borderRadius: "md" }}
              >
                <Typography level="body-sm">
                  No file has been uploaded for this book yet.
                </Typography>
              </Sheet>
            )}
          </Box>
        </Box>
      </Container>
      {editing && (
        <EditDialog
          book={book}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
    </>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
