import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Sheet,
  Typography,
  Button,
  Alert,
  Avatar,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Header } from "../components/Header";
import type { User } from "../api/types";
import { getFile, downloadURL } from "./drive/api";
import type { DriveFile } from "./drive/types";
import { FilePreview } from "./drive/FilePreview";
import { apps } from "../catalog/apps";

interface EditorPlaceholderProps {
  user: User;
  /** Catalog id of the editor (sheets / docs / slides / pdf). */
  appId: string;
}

/**
 * Placeholder page for a per-type editor that hasn't shipped yet. Opens at
 * /sheets/:id, /docs/:id, /slides/:id, /pdf/:id. Shows a coming-soon banner
 * in the editor's brand color, plus the same FilePreview the generic
 * FileViewer uses — so the user still sees their file content.
 */
export function EditorPlaceholder({ user, appId }: EditorPlaceholderProps) {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [file, setFile] = useState<DriveFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const app = apps.find((a) => a.id === appId);

  useEffect(() => {
    let cancelled = false;
    getFile(id)
      .then((f) => {
        if (!cancelled) setFile(f);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
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
  if (!file || !app) {
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

  return (
    <>
      <Header user={user} />
      {/* Editor chrome bar — uses the editor's accent color from the catalog. */}
      <Sheet
        variant="solid"
        sx={{
          bgcolor: app.accentColor,
          color: "#fff",
          px: 3,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Avatar
          variant="plain"
          sx={{ bgcolor: "rgba(255,255,255,0.15)", color: "#fff" }}
        >
          {(() => {
            const Icon = (
              Icons as Record<string, React.ComponentType<{ sx?: object }>>
            )[app.iconName];
            return Icon ? <Icon /> : <Icons.Description />;
          })()}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            level="body-sm"
            sx={{ color: "rgba(255,255,255,0.85)", lineHeight: 1 }}
          >
            {app.name}
          </Typography>
          <Typography
            level="title-md"
            sx={{
              color: "#fff",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </Typography>
        </Box>
        <Button
          component="a"
          href={url}
          download={file.name}
          variant="soft"
          color="neutral"
          startDecorator={<Icons.Download />}
        >
          Download
        </Button>
        <Button
          onClick={() => navigate("/drive")}
          variant="plain"
          color="neutral"
          sx={{
            color: "#fff",
            "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
          }}
          startDecorator={<Icons.ArrowBack />}
        >
          Back to Drive
        </Button>
      </Sheet>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Alert
          variant="soft"
          color="warning"
          startDecorator={<Icons.Construction />}
          sx={{ mb: 2 }}
        >
          <Box>
            <Typography level="title-sm">
              {app.name} editor is coming soon
            </Typography>
            <Typography level="body-sm" sx={{ opacity: 0.85 }}>
              For now this is a preview of the file. Full editing in {app.name}{" "}
              will land in a future release.
            </Typography>
          </Box>
        </Alert>

        <FilePreview file={file} />
      </Container>
    </>
  );
}
