import { useEffect, useCallback, useRef } from "react";
import { Box, IconButton, Sheet, Typography, Tooltip } from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LibraryAddIcon from "@mui/icons-material/LibraryAdd";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import EditIcon from "@mui/icons-material/Edit";
import type { Photo } from "./types";
import { photoURL, downloadURL } from "./api";

interface LightboxProps {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onToggleFavorite: (p: Photo) => void;
  onDelete: (p: Photo) => void;
  onAddToAlbum: (p: Photo) => void;
  onInfo: (p: Photo) => void;
  onEdit?: (p: Photo) => void;
}

/** Lightbox is the full-screen single-photo viewer with prev/next navigation
 *  and an action toolbar, mirroring Google Photos' photo detail view. */
export function Lightbox({
  photos,
  index,
  onClose,
  onNavigate,
  onToggleFavorite,
  onDelete,
  onAddToAlbum,
  onInfo,
  onEdit,
}: LightboxProps) {
  const photo = photos[index];
  const touchStartX = useRef<number | null>(null);

  const prev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);
  const next = useCallback(() => {
    if (index < photos.length - 1) onNavigate(index + 1);
  }, [index, photos.length, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  if (!photo) return null;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return; // too small, treat as tap
    if (dx < 0) next();
    else prev();
  }

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={photo.filename || "Photo"}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        bgcolor: "rgba(0,0,0,0.94)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={onClose}
    >
      {/* Top toolbar */}
      <Sheet
        variant="plain"
        onClick={(e) => e.stopPropagation()}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          bgcolor: "transparent",
          color: "#fff",
          flexWrap: "nowrap",
          minHeight: 48,
        }}
      >
        <IconButton
          variant="plain"
          onClick={onClose}
          aria-label="Close"
          sx={{ color: "#fff" }}
        >
          <CloseIcon />
        </IconButton>
        <Typography
          level="body-sm"
          sx={{ color: "#fff", flex: 1, opacity: 0.85 }}
          noWrap
        >
          {photo.filename}
        </Typography>
        <Tooltip title={photo.favorite ? "Unfavorite" : "Favorite"}>
          <IconButton
            variant="plain"
            onClick={() => onToggleFavorite(photo)}
            aria-label="Favorite"
            sx={{ color: "#fff" }}
          >
            {photo.favorite ? (
              <StarIcon sx={{ color: "#f9ab00" }} />
            ) : (
              <StarBorderIcon />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Add to album">
          <IconButton
            variant="plain"
            onClick={() => onAddToAlbum(photo)}
            aria-label="Add to album"
            sx={{ color: "#fff" }}
          >
            <LibraryAddIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Get info">
          <IconButton
            variant="plain"
            onClick={() => onInfo(photo)}
            aria-label="Get info"
            sx={{ color: "#fff" }}
          >
            <InfoOutlinedIcon />
          </IconButton>
        </Tooltip>
        {onEdit && (
          <Tooltip title="Edit photo">
            <IconButton
              variant="plain"
              onClick={() => onEdit(photo)}
              aria-label="Edit photo"
              sx={{ color: "#fff" }}
            >
              <EditIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Download">
          <IconButton
            component="a"
            href={downloadURL(photo.id)}
            variant="plain"
            aria-label="Download"
            sx={{ color: "#fff" }}
          >
            <DownloadIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            variant="plain"
            onClick={() => onDelete(photo)}
            aria-label="Delete"
            sx={{ color: "#fff" }}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Tooltip>
      </Sheet>

      {/* Image area — supports swipe on mobile */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
          position: "relative",
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {index > 0 && (
          <IconButton
            variant="solid"
            color="neutral"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            aria-label="Previous photo"
            sx={{
              position: "absolute",
              left: { xs: 4, sm: 16 },
              bgcolor: "rgba(255,255,255,0.12)",
              color: "#fff",
              "&:hover": { bgcolor: "rgba(255,255,255,0.24)" },
              minWidth: 40,
              minHeight: 40,
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
        )}
        <Box
          component="img"
          src={photoURL(photo.id)}
          alt={photo.description || photo.filename}
          onClick={(e) => e.stopPropagation()}
          sx={{
            maxWidth: "92vw",
            maxHeight: "80vh",
            objectFit: "contain",
            userSelect: "none",
            touchAction: "pinch-zoom",
          }}
        />
        {index < photos.length - 1 && (
          <IconButton
            variant="solid"
            color="neutral"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            aria-label="Next photo"
            sx={{
              position: "absolute",
              right: { xs: 4, sm: 16 },
              bgcolor: "rgba(255,255,255,0.12)",
              color: "#fff",
              "&:hover": { bgcolor: "rgba(255,255,255,0.24)" },
              minWidth: 40,
              minHeight: 40,
            }}
          >
            <ChevronRightIcon />
          </IconButton>
        )}
      </Box>
      <Box sx={{ textAlign: "center", py: 1 }}>
        <Typography level="body-xs" sx={{ color: "rgba(255,255,255,0.6)" }}>
          {index + 1} / {photos.length}
        </Typography>
      </Box>
    </Box>
  );
}
