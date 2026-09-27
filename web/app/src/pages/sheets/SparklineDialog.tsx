import { useEffect, useState } from "react";
import { Modal, ModalDialog, ModalClose, Typography, FormControl, FormLabel, Input, Select, Option, Button, Box, Stack, IconButton, Divider } from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import { getSelectionRange, parseRangeText, rangeText, type ChartRange } from "./chartData";
import { sparklineFormulas, sheetSparklines, type SparklineGroup, type SparklineType } from "./sparklines";
import { currentSheet, patchSheet } from "./sheetDataTools";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface SparklineDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

/**
 * Insert ▸ Sparklines: a group of in-cell sparklines (one per row or column of
 * a data range) written as SPARKLINE() formulas into a location range, and
 * kept as a group on the sheet (grownSparklines) so it can be changed or
 * removed together, like a spreadsheet's sparkline group.
 */
export function SparklineDialog({ open, onClose, getWb }: SparklineDialogProps) {
  const [data, setData] = useState("");
  const [loc, setLoc] = useState("");
  const [type, setType] = useState<SparklineType>("line");
  const [color, setColor] = useState("#4472c4");
  const [groups, setGroups] = useState<SparklineGroup[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const wb = getWb();
    const sel = wb ? getSelectionRange(wb) : null;
    setData(sel ? rangeText(sel) : "");
    // Default location: the column right of the data.
    setLoc(sel ? rangeText({ r0: sel.r0, r1: sel.r1, c0: sel.c1 + 1, c1: sel.c1 + 1 }) : "");
    setGroups(sheetSparklines(currentSheet(wb)));
    setError("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function write(wb: any, cells: { r: number; c: number; f: string | null }[], fc?: string) {
    const calls = cells.map((x) =>
      x.f === null
        ? { name: "clearCell", args: [x.r, x.c] }
        : { name: "setCellValue", args: [x.r, x.c, { f: x.f, v: "", m: "", ...(fc ? { fc } : {}) }] },
    );
    if (wb.batchCallApis) wb.batchCallApis(calls);
    else for (const c of calls) wb[c.name]?.(...c.args);
  }

  function save(list: SparklineGroup[]) {
    const wb = getWb();
    const sheet = currentSheet(wb);
    if (sheet?.id) patchSheet(wb, sheet.id, { grownSparklines: list });
    setGroups(list);
  }

  function insert() {
    const wb = getWb();
    const d = parseRangeText(data);
    const l = parseRangeText(loc);
    if (!wb || !d || !l) {
      setError("Enter a data range and a location range.");
      return;
    }
    const group: SparklineGroup = { id: `spark_${Date.now()}`, data: d, location: l, type, color };
    const cells = sparklineFormulas(group);
    if ("error" in cells) {
      setError(cells.error);
      return;
    }
    write(wb, cells, color);
    const overlaps = (a: ChartRange, b: ChartRange) => !(a.r1 < b.r0 || b.r1 < a.r0 || a.c1 < b.c0 || b.c1 < a.c0);
    save([...groups.filter((g) => !overlaps(g.location, l)), group]);
    onClose();
  }

  function remove(g: SparklineGroup) {
    const wb = getWb();
    const cells: { r: number; c: number; f: null }[] = [];
    for (let r = g.location.r0; r <= g.location.r1; r++) for (let c = g.location.c0; c <= g.location.c1; c++) cells.push({ r, c, f: null });
    if (wb) write(wb, cells);
    save(groups.filter((x) => x.id !== g.id));
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 460, maxWidth: "96vw" }} aria-labelledby="spark-title">
        <ModalClose />
        <Typography id="spark-title" level="title-lg">
          Sparklines
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <FormControl>
            <FormLabel>Data range</FormLabel>
            <Input size="sm" value={data} onChange={(e) => setData(e.target.value)} placeholder="B2:G10" slotProps={{ input: { "aria-label": "Sparkline data range" } }} />
          </FormControl>
          <FormControl>
            <FormLabel>Location (one cell per row or column of data)</FormLabel>
            <Input size="sm" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="H2:H10" slotProps={{ input: { "aria-label": "Sparkline location" } }} />
          </FormControl>
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Type</FormLabel>
              <Select size="sm" value={type} onChange={(_, v) => v && setType(v as SparklineType)} slotProps={{ button: { "aria-label": "Sparkline type" } }}>
                <Option value="line">Line</Option>
                <Option value="column">Column</Option>
                <Option value="winloss">Win/loss</Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Colour</FormLabel>
              <input type="color" aria-label="Sparkline colour" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, height: 30, border: "none", background: "none" }} />
            </FormControl>
          </Box>
          {error && (
            <Typography level="body-sm" color="danger">
              {error}
            </Typography>
          )}
          {groups.length > 0 && (
            <>
              <Divider />
              <Typography level="title-sm">Sparkline groups on this sheet</Typography>
              {groups.map((g) => (
                <Box key={g.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: 2, bgcolor: g.color ?? "#4472c4" }} />
                  <Typography level="body-sm" sx={{ flex: 1 }}>
                    {g.type} · {rangeText(g.data)} → {rangeText(g.location)}
                  </Typography>
                  <IconButton size="sm" variant="plain" color="danger" aria-label="Remove sparkline group" onClick={() => remove(g)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </>
          )}
        </Stack>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1.5 }}>
          <Button variant="plain" onClick={onClose}>
            Close
          </Button>
          <Button onClick={insert}>Insert</Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
