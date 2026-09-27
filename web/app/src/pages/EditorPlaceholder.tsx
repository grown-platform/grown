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
import { needsServerConversion, useOfficeConvertCaps } from "../lib/officeConvert";

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
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const app = apps.find((a) => a.id === appId);
  // Optional server-side LibreOffice (CC8): legacy .doc/.xls/.ppt open too.
  const officeCaps = useOfficeConvertCaps();

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
  // A .pptx or .odp opened from Drive can be converted into a Grown Slides deck (a
  // copy; the Drive file is left as is).
  const canOpenInSlides =
    appId === "slides" &&
    (/\.(pptx|odp)$/i.test(file.name) ||
      needsServerConversion(officeCaps, file.name, "pptx") ||
      file.mime_type ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      file.mime_type === "application/vnd.oasis.opendocument.presentation");

  // A spreadsheet opened from Drive can be imported into a Grown Sheets
  // workbook (a copy; the Drive file is left as is).
  const canOpenInSheets =
    appId === "sheets" &&
    (/\.(xlsx|xlsm|xls|ods|csv|tsv)$/i.test(file.name) ||
      needsServerConversion(officeCaps, file.name, "xlsx"));

  // A word-processing file can be imported into a new Grown Docs document
  // (a copy): .docx/.odt/.rtf always, legacy .doc/.wpd when the server has
  // LibreOffice.
  const canOpenInDocs =
    appId === "docs" &&
    (/\.(docx|odt|rtf)$/i.test(file.name) ||
      needsServerConversion(officeCaps, file.name, "docx"));
  const openTarget = canOpenInDocs ? "Docs" : canOpenInSheets ? "Sheets" : canOpenInSlides ? "Slides" : null;

  async function openInDocs() {
    if (!file) return;
    setConverting(true);
    setConvertError(null);
    try {
      const resp = await fetch(url, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const { importFile, createDoc } = await import("./docs/api");
      const { stashDocxSeed } = await import("./docs/docx/seed");
      const imported = await importFile(new File([blob], file.name, { type: file.mime_type }));
      const doc = await createDoc(file.name.replace(/\.[^.]+$/, "") || "Imported document");
      if (imported.kind === "docx") stashDocxSeed(doc.id, imported.model);
      else sessionStorage.setItem(`docseed:${doc.id}`, imported.html);
      navigate(`/docs/d/${doc.id}`);
    } catch (e) {
      setConvertError((e as Error).message);
      setConverting(false);
    }
  }

  async function openInSheets() {
    if (!file) return;
    setConverting(true);
    setConvertError(null);
    try {
      const resp = await fetch(url, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const { importSpreadsheetFile, applyImport } = await import("./sheets/sheetImport");
      const { createSheet, saveSheet } = await import("./sheets/api");
      const imp = await importSpreadsheetFile(bytes, file.name, { userId: user.id });
      const sheet = await createSheet(file.name.replace(/\.[^.]+$/, ""));
      await saveSheet(sheet.id, JSON.stringify(applyImport([], imp, "newSpreadsheet")));
      navigate(`/sheets/d/${sheet.id}`);
    } catch (e) {
      setConvertError((e as Error).message);
      setConverting(false);
    }
  }

  async function openInSlides() {
    if (!file) return;
    setConverting(true);
    setConvertError(null);
    try {
      const resp = await fetch(url, { credentials: "same-origin" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { importPptxAsNewDeck } = await import("./slides/pptx/importDeck");
      const { id: deckId } = await importPptxAsNewDeck(
        await resp.blob(),
        file.name,
      );
      navigate(`/slides/d/${deckId}`);
    } catch (e) {
      setConvertError((e as Error).message);
      setConverting(false);
    }
  }

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
        {canOpenInDocs && (
          <Button
            onClick={openInDocs}
            loading={converting}
            variant="solid"
            color="neutral"
            startDecorator={<Icons.Description />}
            data-testid="open-in-docs"
          >
            Open in Docs
          </Button>
        )}
        {canOpenInSheets && (
          <Button
            onClick={openInSheets}
            loading={converting}
            variant="solid"
            color="neutral"
            startDecorator={<Icons.TableChart />}
            data-testid="open-in-sheets"
          >
            Open in Sheets
          </Button>
        )}
        {canOpenInSlides && (
          <Button
            onClick={openInSlides}
            loading={converting}
            variant="solid"
            color="neutral"
            startDecorator={<Icons.Slideshow />}
            data-testid="open-in-slides"
          >
            Open in Slides
          </Button>
        )}
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
        {convertError && (
          <Alert variant="soft" color="danger" sx={{ mb: 2 }}>
            Couldn’t open this file in {openTarget ?? app.name}: {convertError}
          </Alert>
        )}
        {openTarget ? (
          <Alert
            variant="soft"
            color="primary"
            startDecorator={canOpenInSlides ? <Icons.Slideshow /> : canOpenInSheets ? <Icons.TableChart /> : <Icons.Description />}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography level="title-sm">
                {canOpenInSlides
                  ? `Edit this ${/\.odp$/i.test(file.name) ? "presentation" : "PowerPoint file"} in Slides`
                  : `Edit this file in ${openTarget}`}
              </Typography>
              <Typography level="body-sm" sx={{ opacity: 0.85 }}>
                “Open in {openTarget}” makes an editable {openTarget} copy. The
                original file stays in Drive unchanged.
              </Typography>
            </Box>
          </Alert>
        ) : (
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
                For now this is a preview of the file. Full editing in{" "}
                {app.name} will land in a future release.
              </Typography>
            </Box>
          </Alert>
        )}

        <FilePreview file={file} />
      </Container>
    </>
  );
}
