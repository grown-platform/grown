// Picture UI (M6): the toolbar controls shown while a picture is selected
// (crop, crop to shape, fill/fit, reset, actual size, fit to slide,
// replace, opacity, shadow) and the alt text dialog (any element).

import { useState } from "react";
import {
  Box,
  Button,
  DialogActions,
  DialogTitle,
  Dropdown,
  FormControl,
  FormLabel,
  IconButton,
  ListDivider,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalDialog,
  Textarea,
  Tooltip,
} from "@mui/joy";
import CropIcon from "@mui/icons-material/Crop";
import type { SlideElement } from "./model";
import { ShapeGallery } from "./ShapeGallery";

export interface ImageCommands {
  /** Crop mode on/off. */
  cropping: boolean;
  toggleCrop: () => void;
  cropToShape: (preset: string | null) => void;
  cropFill: () => void;
  cropFit: () => void;
  resetCrop: () => void;
  actualSize: () => void;
  fitToSlide: () => void;
  replace: () => void;
  setOpacity: (v: number) => void;
  toggleShadow: () => void;
  altText: () => void;
}

/** Toolbar controls for the selected picture. */
export function ImageControls({ el, cmd }: { el: SlideElement | null | undefined; cmd: ImageCommands | null }) {
  const [shapesOpen, setShapesOpen] = useState(false);
  if (!el || el.type !== "image" || !cmd) return null;
  return (
    <Box data-testid="image-controls" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Tooltip title={cmd.cropping ? "Finish cropping (Enter)" : "Crop"}>
        <IconButton
          size="sm"
          variant={cmd.cropping ? "solid" : "plain"}
          color={cmd.cropping ? "primary" : "neutral"}
          aria-label="Crop"
          aria-pressed={cmd.cropping}
          onClick={cmd.toggleCrop}
        >
          <CropIcon />
        </IconButton>
      </Tooltip>
      <Dropdown>
        <MenuButton size="sm" variant="plain" data-testid="image-crop-menu">
          Crop options
        </MenuButton>
        <Menu size="sm">
          <MenuItem onClick={() => cmd.cropToShape(null)} disabled={!el.cropShape}>
            Remove shape
          </MenuItem>
          <MenuItem onClick={cmd.cropFill}>Fill</MenuItem>
          <MenuItem onClick={cmd.cropFit}>Fit</MenuItem>
          <MenuItem onClick={cmd.resetCrop} disabled={!el.crop}>
            Reset crop
          </MenuItem>
          <ListDivider />
          <MenuItem onClick={cmd.actualSize}>Actual size</MenuItem>
          <MenuItem onClick={cmd.fitToSlide}>Fit to slide</MenuItem>
          <MenuItem onClick={cmd.replace}>Replace image…</MenuItem>
          <MenuItem onClick={cmd.altText}>Alt text…</MenuItem>
        </Menu>
      </Dropdown>
      <Dropdown open={shapesOpen} onOpenChange={(_, o) => setShapesOpen(o)}>
        <MenuButton size="sm" variant="plain" data-testid="image-crop-shape">
          Crop to shape
        </MenuButton>
        <Menu size="sm" placement="bottom-start" sx={{ p: 0 }}>
          <ShapeGallery
            shapesOnly
            onPick={(id) => {
              setShapesOpen(false);
              cmd.cropToShape(id);
            }}
          />
        </Menu>
      </Dropdown>
      <Tooltip title="Opacity">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="Opacity"
          value={Math.round((el.opacity ?? 1) * 100)}
          onChange={(e) => cmd.setOpacity(Number(e.target.value) / 100)}
          style={{ width: 80, marginLeft: 4 }}
        />
      </Tooltip>
      <Button size="sm" variant={el.shadow ? "soft" : "plain"} aria-pressed={!!el.shadow} onClick={cmd.toggleShadow}>
        Shadow
      </Button>
    </Box>
  );
}

/** Alt text (pptx `descr`) for any element. */
export function AltTextDialog({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (alt: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <Modal open onClose={onClose}>
      <ModalDialog size="sm" sx={{ minWidth: 360 }} data-testid="alt-text-dialog">
        <DialogTitle>Alt text</DialogTitle>
        <FormControl>
          <FormLabel>Description</FormLabel>
          <Textarea
            autoFocus
            minRows={3}
            value={v}
            onChange={(e) => setV(e.target.value)}
            slotProps={{ textarea: { "aria-label": "Alt text description" } }}
          />
        </FormControl>
        <DialogActions>
          <Button onClick={() => onSave(v)}>Save</Button>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
