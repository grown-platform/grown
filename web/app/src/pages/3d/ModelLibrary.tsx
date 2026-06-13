/**
 * ModelLibrary — the 3D app's default landing view: a responsive gallery of the
 * user's 3D models, each shown with a client-rendered preview thumbnail and
 * clickable to open in the full Viewer.
 *
 * The "/models" area: by convention a Drive folder named "models" (or "Models")
 * at the user's Drive root. We resolve it by listing the root and matching that
 * name (case-insensitive). If it's missing we show a friendly empty state with
 * a "Create models folder" button (the Drive api supports createFolder). When
 * found, we list its model files RECURSIVELY (nicer than one level) so models
 * nested in sub-folders still appear.
 *
 * Thumbnails are rendered lazily via IntersectionObserver + a single shared
 * offscreen renderer with a sequential queue + a two-tier cache — see
 * ThumbnailRenderer.ts for the memory strategy. Renderable formats
 * (glb/gltf/obj/stl/ply) get a real preview; other recognized formats show a
 * format-icon placeholder.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  Button,
  Card,
  CardContent,
  CardOverflow,
  AspectRatio,
  Chip,
  CircularProgress,
} from "@mui/joy";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import RefreshIcon from "@mui/icons-material/Refresh";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderOffIcon from "@mui/icons-material/FolderOff";
import { listFiles, createFolder, downloadURL } from "../drive/api";
import { isFolder, type DriveFile } from "../drive/types";
import { isModelFile, isRenderable, extOf } from "./formats";
import {
  requestThumbnail,
  getCachedThumbnail,
} from "./ThumbnailRenderer";
import { seedExampleShipIfNeeded, hasSeededExample } from "./seedExample";

interface LibModel {
  file: DriveFile;
  /** Slash-joined folder path under /models, e.g. "characters/" or "" at root. */
  relPath: string;
}

export interface ModelLibraryProps {
  /** Open a model in the full viewer (parent switches view + loads bytes). */
  onOpen: (file: DriveFile) => void;
}

export function ModelLibrary({ onOpen }: ModelLibraryProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelsFolder, setModelsFolder] = useState<DriveFile | null>(null);
  const [models, setModels] = useState<LibModel[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) Find the /models folder at the Drive root.
      const root = await listFiles("");
      let folder =
        root.find((f) => isFolder(f) && f.name.toLowerCase() === "models") ??
        null;
      // First-run seeding: a fresh user has no /models folder and nothing to
      // look at. Auto-create the folder once and drop in a default example ship
      // so the library isn't empty. Guarded (hasSeededExample) so a user who
      // later deletes the folder/example isn't handed it back.
      if (!folder && !hasSeededExample()) {
        try {
          folder = await createFolder("models", "");
        } catch {
          /* leave null → fall through to the create-folder empty state */
        }
      }
      setModelsFolder(folder);
      if (!folder) {
        setModels([]);
        return;
      }
      // 2) List model files recursively under /models.
      let found = await listModelsRecursive(folder.id, "");
      // Seed the example ship when the library is empty (best-effort, guarded).
      if (found.length === 0) {
        const seeded = await seedExampleShipIfNeeded(folder.id, []);
        if (seeded) found = await listModelsRecursive(folder.id, "");
      }
      // Folders first is irrelevant here; sort by path then name.
      found.sort((a, b) => {
        if (a.relPath !== b.relPath) return a.relPath.localeCompare(b.relPath);
        return a.file.name.localeCompare(b.file.name);
      });
      setModels(found);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createModelsFolder() {
    setCreating(true);
    setError(null);
    try {
      const folder = await createFolder("models", "");
      // Drop the example ship in so the freshly-created folder isn't empty.
      await seedExampleShipIfNeeded(folder.id, []);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Library header / breadcrumb */}
      <Sheet
        variant="soft"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1,
          borderRadius: 0,
        }}
      >
        <Typography level="title-md">Model Library</Typography>
        <Chip size="sm" variant="outlined" color="neutral">
          {modelsFolder ? "My Drive / models" : "My Drive / models (missing)"}
        </Chip>
        <Box sx={{ flex: 1 }} />
        {!loading && (
          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
            {models.length} {models.length === 1 ? "model" : "models"}
          </Typography>
        )}
        <Button
          variant="outlined"
          size="sm"
          startDecorator={<RefreshIcon />}
          onClick={() => void load()}
          loading={loading}
        >
          Refresh
        </Button>
      </Sheet>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
        {error && (
          <Sheet
            variant="soft"
            color="danger"
            sx={{ p: 1.5, borderRadius: "md", mb: 2 }}
          >
            <Typography level="body-sm" color="danger">
              {error}
            </Typography>
          </Sheet>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : !modelsFolder ? (
          <EmptyNoFolder onCreate={createModelsFolder} creating={creating} />
        ) : models.length === 0 ? (
          <EmptyNoModels />
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns:
                "repeat(auto-fill, minmax(180px, 1fr))",
            }}
          >
            {models.map((m) => (
              <ModelCard key={m.file.id} model={m} onOpen={onOpen} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/** Recursively list renderable + recognized model files under a folder. */
async function listModelsRecursive(
  parentId: string,
  relPath: string,
): Promise<LibModel[]> {
  const entries = await listFiles(parentId);
  const out: LibModel[] = [];
  const subfolders: DriveFile[] = [];
  for (const f of entries) {
    if (isFolder(f)) {
      subfolders.push(f);
    } else if (isModelFile(f.name) && isRenderable(f.name)) {
      // Library only surfaces files the picker treats as models. Companion
      // assets (bin/mtl) are model-files but not standalone models; restrict to
      // renderable types so each card represents an openable model.
      out.push({ file: f, relPath });
    } else if (isModelFile(f.name)) {
      // Recognized-but-not-yet-renderable (fbx/3ds/dae/off/3mf/wrl): still show
      // a card (placeholder thumbnail) so users see the model exists.
      const e = extOf(f.name);
      if (!["bin", "mtl"].includes(e)) out.push({ file: f, relPath });
    }
  }
  // Recurse into subfolders (sequentially to keep request load modest).
  for (const sf of subfolders) {
    const child = await listModelsRecursive(
      sf.id,
      relPath ? `${relPath}${sf.name}/` : `${sf.name}/`,
    );
    out.push(...child);
  }
  return out;
}

/** A single model card with a lazily-rendered preview thumbnail. */
function ModelCard({
  model,
  onOpen,
}: {
  model: LibModel;
  onOpen: (file: DriveFile) => void;
}) {
  const { file, relPath } = model;
  const ext = extOf(file.name);
  const renderable = isRenderable(file.name);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<string | null>(() =>
    getCachedThumbnail(file.id, file.updated_at),
  );
  const [thumbState, setThumbState] = useState<
    "idle" | "pending" | "done" | "error"
  >(() =>
    getCachedThumbnail(file.id, file.updated_at) ? "done" : "idle",
  );

  // Lazily render the thumbnail only when the card scrolls into view.
  useEffect(() => {
    if (!renderable || thumb || thumbState !== "idle") return;
    const el = cardRef.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (cancelled) return;
        setThumbState("pending");
        requestThumbnail({
          fileId: file.id,
          updatedAt: file.updated_at,
          name: file.name,
          fetchBytes: async () => {
            const res = await fetch(downloadURL(file.id), {
              credentials: "same-origin",
            });
            if (!res.ok) {
              throw new Error(`download ${res.status}`);
            }
            return res.arrayBuffer();
          },
        })
          .then((url) => {
            if (cancelled) return;
            setThumb(url);
            setThumbState("done");
          })
          .catch(() => {
            if (cancelled) return;
            setThumbState("error");
          });
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [renderable, thumb, thumbState, file.id, file.updated_at, file.name]);

  return (
    <Card
      ref={cardRef}
      variant="outlined"
      onClick={() => onOpen(file)}
      sx={{
        cursor: "pointer",
        transition: "box-shadow 120ms, transform 120ms",
        "&:hover": { boxShadow: "md", transform: "translateY(-2px)" },
      }}
    >
      <CardOverflow>
        <AspectRatio ratio="1" sx={{ bgcolor: "#f4f5f7" }}>
          {thumb ? (
            <img src={thumb} alt={file.name} loading="lazy" />
          ) : thumbState === "pending" ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress size="sm" />
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "neutral.400",
                gap: 0.5,
              }}
            >
              <ViewInArIcon sx={{ fontSize: 40 }} />
              {thumbState === "error" && (
                <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                  no preview
                </Typography>
              )}
            </Box>
          )}
        </AspectRatio>
      </CardOverflow>
      <CardContent>
        <Typography level="title-sm" noWrap title={file.name}>
          {file.name}
        </Typography>
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}
        >
          <Chip
            size="sm"
            variant="soft"
            color={renderable ? "primary" : "neutral"}
          >
            {ext.toUpperCase() || "3D"}
          </Chip>
          {relPath && (
            <Typography level="body-xs" noWrap sx={{ opacity: 0.55 }}>
              {relPath}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function EmptyNoFolder({
  onCreate,
  creating,
}: {
  onCreate: () => void;
  creating: boolean;
}) {
  return (
    <Box
      sx={{
        textAlign: "center",
        py: 8,
        px: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1.5,
      }}
    >
      <FolderOffIcon sx={{ fontSize: 48, color: "neutral.400" }} />
      <Typography level="title-md">No models yet</Typography>
      <Typography level="body-sm" sx={{ opacity: 0.7, maxWidth: 420 }}>
        Add models to a "models" folder at your Drive root, or use File ▸ Open to
        load one directly. You can create the folder now and drop models into it
        from Drive.
      </Typography>
      <Button
        startDecorator={<CreateNewFolderIcon />}
        onClick={onCreate}
        loading={creating}
      >
        Create models folder
      </Button>
    </Box>
  );
}

function EmptyNoModels() {
  return (
    <Box
      sx={{
        textAlign: "center",
        py: 8,
        px: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
      }}
    >
      <ViewInArIcon sx={{ fontSize: 48, color: "neutral.400" }} />
      <Typography level="title-md">Your models folder is empty</Typography>
      <Typography level="body-sm" sx={{ opacity: 0.7, maxWidth: 420 }}>
        Add 3D models (glb, gltf, obj, stl, ply) to the "models" folder in Drive,
        then hit Refresh. You can also use File ▸ Open to load any model.
      </Typography>
    </Box>
  );
}
