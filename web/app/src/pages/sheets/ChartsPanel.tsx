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
import { ChartRenderer } from "./ChartRenderer";
import { buildChartInput, rangeText, type ChartConfig } from "./chartData";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface ChartsPanelProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  charts: ChartConfig[];
  onDelete: (id: string) => void;
  onNew: () => void;
}

export function ChartsPanel({ open, onClose, getWb, charts, onDelete, onNew }: ChartsPanelProps) {
  const wb = getWb();
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        layout="fullscreen"
        sx={{ display: "flex", flexDirection: "column" }}
        aria-labelledby="charts-title"
      >
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
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              }}
            >
              {charts.map((c) => {
                const input = wb ? buildChartInput(wb, c) : { categories: [], series: [] };
                return (
                  <Box
                    key={c.id}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: "sm",
                      p: 1,
                      bgcolor: "#fff",
                      position: "relative",
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
                      <Typography level="body-xs" sx={{ opacity: 0.6, color: "#555" }}>
                        {c.type} · {rangeText(c.range)}
                      </Typography>
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="danger"
                        onClick={() => onDelete(c.id)}
                        aria-label="Delete chart"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <ChartRenderer
                      type={c.type}
                      title={c.title || undefined}
                      categories={input.categories}
                      series={input.series}
                      width={340}
                      height={240}
                    />
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
