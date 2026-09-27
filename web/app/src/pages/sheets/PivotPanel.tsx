import { Modal, ModalDialog, ModalClose, Typography, Button, Box, IconButton, Tooltip } from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import { PivotTableView } from "./PivotTableView";
import { buildReport, type PivotConfig } from "./pivotData";
import { rangeText } from "./chartData";
import { colToLetters } from "./cellValue";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface PivotPanelProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  pivots: PivotConfig[];
  onDelete: (id: string) => void;
  onNew: () => void;
  onEdit: (p: PivotConfig) => void;
  onRefresh: () => void;
  /** Show details for a report cell (report coordinates). */
  onDetails: (p: PivotConfig, r: number, c: number) => void;
  /** Show details for the grid's selected cell, when it is a pivot value. */
  onDetailsHere: () => void;
  /** Copy the GETPIVOTDATA formula for the grid's selected pivot value. */
  onFormulaHere: () => void;
}

function sheetName(wb: any, id?: string): string {
  try {
    const s = (wb?.getAllSheets?.() ?? []).find((x: any) => String(x.id) === String(id));
    return s ? String(s.name) : "";
  } catch {
    return "";
  }
}

export function PivotPanel({ open, onClose, getWb, pivots, onDelete, onNew, onEdit, onRefresh, onDetails, onDetailsHere, onFormulaHere }: PivotPanelProps) {
  const wb = getWb();
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog layout="fullscreen" sx={{ display: "flex", flexDirection: "column" }} aria-labelledby="pivots-title">
        <ModalClose />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
          <Typography id="pivots-title" level="title-lg">
            Pivot tables
          </Typography>
          <Button size="sm" variant="outlined" startDecorator={<AddIcon />} onClick={onNew}>
            New pivot table
          </Button>
          <Button size="sm" variant="outlined" startDecorator={<RefreshIcon />} onClick={onRefresh}>
            Refresh all
          </Button>
          <Button size="sm" variant="plain" onClick={onDetailsHere}>
            Show details for selected cell
          </Button>
          <Button size="sm" variant="plain" onClick={onFormulaHere}>
            Copy GETPIVOTDATA for selected cell
          </Button>
        </Box>
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {pivots.length === 0 ? (
            <Typography level="body-sm" sx={{ opacity: 0.6, mt: 2 }}>
              No pivot tables yet. Select a data range (with headers) and use “New pivot table”.
            </Typography>
          ) : (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", alignItems: "start" }}>
              {pivots.map((p) => {
                let report = null;
                try {
                  report = wb ? buildReport(wb, p) : null;
                } catch {
                  report = null;
                }
                const where = p.anchor ? `${sheetName(wb, p.anchor.sheetId)}!${colToLetters(p.anchor.c)}${p.anchor.r + 1}` : "panel only";
                return (
                  <Box key={p.id} data-testid="pivot-card" sx={{ border: "1px solid", borderColor: "divider", borderRadius: "sm", p: 1, bgcolor: "background.surface" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
                      <Typography level="body-sm" sx={{ fontWeight: 600, flex: 1 }}>
                        {p.title || "Pivot table"}{" "}
                        <Typography level="body-xs" sx={{ opacity: 0.6, fontWeight: 400 }}>
                          · {sheetName(wb, p.sourceSheetId)}
                          {sheetName(wb, p.sourceSheetId) ? "!" : ""}
                          {rangeText(p.range)} → {where}
                        </Typography>
                      </Typography>
                      <Tooltip title="Edit">
                        <IconButton size="sm" variant="plain" onClick={() => onEdit(p)} aria-label="Edit pivot table">
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="sm" variant="plain" color="danger" onClick={() => onDelete(p.id)} aria-label="Delete pivot table">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    {report && !report.empty && <PivotTableView report={report} onValueClick={(r, c) => onDetails(p, r, c)} maxRows={120} />}
                    <Typography level="body-xs" sx={{ opacity: 0.6, mt: 0.5 }}>
                      Click a value to see the records behind it.
                    </Typography>
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
