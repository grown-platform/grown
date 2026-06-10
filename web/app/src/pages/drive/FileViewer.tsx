import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Button, Typography, Container } from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getFile, downloadURL } from "./api";
import type { DriveFile } from "./types";
import { FilePreview } from "./FilePreview";

interface FileViewerProps {
  user: User;
}

/**
 * FileViewer dispatches on mime_type:
 *   application/pdf  -> <PdfPreview /> (pdfjs canvas render)
 *   image/*          -> native <img>
 *   video/*          -> native <video controls>
 *   audio/*          -> native <audio controls>
 *   text/csv         -> <CsvPreview /> (table render)
 *   text/* + json    -> <iframe> (browser default text renderer)
 *   anything else    -> Download button only
 */
export function FileViewer({ user }: FileViewerProps) {
  const { id = "" } = useParams<{ id: string }>();
  const [file, setFile] = useState<DriveFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    getFile(id)
      .then((f) => {
        if (!cancelled) setFile(f);
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <>
        <Header user={user} />
        <Container sx={{ py: 4 }}>
          <Typography color="danger">{error}</Typography>
          <Button
            onClick={() => navigate("/drive")}
            variant="plain"
            startDecorator={<Icons.ArrowBack />}
          >
            Back to Drive
          </Button>
        </Container>
      </>
    );
  }
  if (!file) {
    return (
      <>
        <Header user={user} />
        <Container sx={{ py: 4 }}>
          <Typography sx={{ opacity: 0.7 }}>Loading…</Typography>
        </Container>
      </>
    );
  }

  const url = downloadURL(file.id);
  const m = file.mime_type;

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Box>
            <Typography level="h3">{file.name}</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.6 }}>
              {m}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              component="a"
              href={url}
              download={file.name}
              variant="soft"
              startDecorator={<Icons.Download />}
            >
              Download
            </Button>
            <Button
              onClick={() => navigate("/drive")}
              variant="plain"
              startDecorator={<Icons.ArrowBack />}
            >
              Back
            </Button>
          </Box>
        </Box>
        <FilePreview file={file} />
      </Container>
    </>
  );
}
