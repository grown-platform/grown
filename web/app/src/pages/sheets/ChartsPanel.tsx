import { Modal, ModalDialog, ModalClose, Typography, Button, Box, IconButton, Tooltip } from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import GridOnIcon from "@mui/icons-material/GridOn";
import GridOffIcon from "@mui/icons-material/GridOff";
import { ChartRenderer, chartTypeLabel } from "./ChartRenderer";
import { buildChartInput, defaultAnchor, rangeText, type ChartConfig } from "./chartData";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface ChartsPanelProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  charts: ChartConfig[];
  onDelete: (id: string) => void;
  onNew: () => void;
  onEdit: (cfg: ChartConfig) => void;
  onChange: (cfg: ChartConfig) => void;
}

/** Every chart of the workbook: edit, delete, place on or take off the grid. */
export function ChartsPanel({ open, onClose, getWb, charts, onDelete, onNew, onEdit, onChange }: ChartsPanelProps) {
  const wb = getWb();
  const sheetName = (id?: string) => {
    try {
      const all: any[] = wb?.getAllSheets?.() ?? [];
      return (all.find((s) => String(s.id) === String(id)) ?? all[0])?.name ?? "";
    } catch {
      return "";
    }
  };
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog layout="fullscreen" sx={{ display: "flex", flexDirection: "column" }} aria-labelledby="charts-title">
        <ModalClose />
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          <Typography id="charts-title" level="title-lg">
            Charts
          </Typography>
          <Button size="sm" variant="outlined" startDecorator={<AddIcon />} onClick={onNew}>
            New chart
          </Button>
        </Box>

        <Box sx={{ flex: 1, overflow: "auto" }}>
          {charts.length === 0 ? (
            <Typography level="body-sm" sx={{ opacity: 0.6, mt: 2 }}>
              No charts yet. Select a data range and use “New chart”.
            </Typography>
          ) : (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
              {charts.map((c) => {
                const input = wb ? buildChartInput(wb, c) : { categories: [], series: [] };
                return (
                  <Box key={c.id} data-testid="panel-chart" sx={{ border: "1px solid", borderColor: "divider", borderRadius: "sm", p: 1, bgcolor: "#fff" }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography level="body-xs" sx={{ color: "#555" }}>
                        {chartTypeLabel(c.type)} · {sheetName(c.sheetId)}!{rangeText(c.range)} · {c.anchor ? "on the grid" : "panel only"}
                      </Typography>
                      <Box>
                        <Tooltip title={c.anchor ? "Take off the grid" : "Place on the grid"} size="sm">
                          <IconButton
                            size="sm"
                            variant="plain"
                            aria-label={c.anchor ? "Take off the grid" : "Place on the grid"}
                            onClick={() => onChange({ ...c, anchor: c.anchor ? undefined : defaultAnchor(c.range) })}
                          >
                            {c.anchor ? <GridOffIcon fontSize="small" /> : <GridOnIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                        <IconButton size="sm" variant="plain" onClick={() => onEdit(c)} aria-label="Edit chart">
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="sm" variant="plain" color="danger" onClick={() => onDelete(c.id)} aria-label="Delete chart">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                    <ChartRenderer config={c} input={input} width={360} height={250} />
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
