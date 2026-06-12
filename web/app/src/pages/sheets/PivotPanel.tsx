import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Button,
  Box,
  IconButton,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { PivotTableView } from "./PivotTableView";
import { buildPivot, type PivotConfig } from "./pivotData";
import { rangeText } from "./chartData";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface PivotPanelProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  pivots: PivotConfig[];
  onDelete: (id: string) => void;
  onNew: () => void;
}

export function PivotPanel({ open, onClose, getWb, pivots, onDelete, onNew }: PivotPanelProps) {
  const wb = getWb();
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        layout="fullscreen"
        sx={{ display: "flex", flexDirection: "column" }}
        aria-labelledby="pivots-title"
      >
        <ModalClose />
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          <Typography id="pivots-title" level="title-lg">
            Pivot tables
          </Typography>
          <Button size="sm" variant="outlined" startDecorator={<AddIcon />} onClick={onNew}>
            New pivot table
          </Button>
        </Box>

        <Box sx={{ flex: 1, overflow: "auto" }}>
          {pivots.length === 0 ? (
            <Typography level="body-sm" sx={{ opacity: 0.6, mt: 2 }}>
              No pivot tables yet. Select a data range (with headers) and use “New pivot table”.
            </Typography>
          ) : (
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
                alignItems: "start",
              }}
            >
              {pivots.map((p) => {
                const result = wb ? buildPivot(wb, p) : null;
                return (
                  <Box
                    key={p.id}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: "sm",
                      p: 1,
                      bgcolor: "#fff",
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 0.5,
                      }}
                    >
                      <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                        {p.title || "Pivot table"}{" "}
                        <Typography level="body-xs" sx={{ opacity: 0.6, fontWeight: 400 }}>
                          · {rangeText(p.range)}
                        </Typography>
                      </Typography>
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="danger"
                        onClick={() => onDelete(p.id)}
                        aria-label="Delete pivot table"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    {result && <PivotTableView result={result} />}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </ModalDialog>
    </Modal>
  );
}
