import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Typography,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { CellRect } from "./cellRange";
import { cellDisplay, colToLetters, parseA1Range, rectToA1 } from "./cellValue";
import { cellGetter, guessHeader, sortRangeWith } from "./editActions";
import type { SortKey } from "./sortOps";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Data ▸ Sort range ▸ Advanced range sorting options: several sort keys
// (a column, or a row when sorting left to right), each A→Z or Z→A on
// values or with a chosen fill/font colour on top, a header row that stays
// put, and a case-sensitive option. The sort is stable.

interface KeyRow extends SortKey {
  uid: number;
}

let uid = 0;

export function SortDialog({
  open,
  onClose,
  getWb,
  range: initial,
}: {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
  range: CellRect | null;
}) {
  const [rangeText, setRangeText] = useState("");
  const [header, setHeader] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [orientation, setOrientation] = useState<"rows" | "columns">("rows");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [error, setError] = useState("");

  const range = useMemo(() => parseA1Range(rangeText) as CellRect | null, [rangeText]);

  useEffect(() => {
    if (!open || !initial) return;
    setRangeText(rectToA1(initial));
    const w = getWb();
    setHeader(w ? guessHeader(w, initial) : false);
    setCaseSensitive(false);
    setOrientation("rows");
    setKeys([{ uid: ++uid, index: initial.c1, ascending: true, by: "value" }]);
    setError("");
  }, [open, initial, getWb]);

  // Labels for the key pickers: header text when there is a header row/column.
  const choices = useMemo(() => {
    if (!range) return [] as { index: number; label: string }[];
    const get = open ? cellGetter(getWb()) : () => null;
    const out: { index: number; label: string }[] = [];
    if (orientation === "rows") {
      for (let c = range.c1; c <= range.c2; c++) {
        const h = header ? cellDisplay(get(range.r1, c)) : "";
        out.push({ index: c, label: h ? `${h} (${colToLetters(c)})` : `Column ${colToLetters(c)}` });
      }
    } else {
      for (let r = range.r1; r <= range.r2; r++) {
        const h = header ? cellDisplay(get(r, range.c1)) : "";
        out.push({ index: r, label: h ? `${h} (row ${r + 1})` : `Row ${r + 1}` });
      }
    }
    return out;
  }, [range, header, orientation, open, getWb]);

  const setKey = (id: number, patch: Partial<SortKey>) =>
    setKeys((ks) => ks.map((k) => (k.uid === id ? { ...k, ...patch } : k)));

  const apply = () => {
    const w = getWb();
    if (!w) return onClose();
    if (!range) return setError("Enter a range such as A1:D20.");
    const ok = sortRangeWith(w, range, {
      keys: keys.map(({ index, ascending, by, color }) => ({ index, ascending, by, color })),
      header,
      caseSensitive,
      orientation,
    });
    if (!ok) return setError("Nothing to sort: check the range and the sort keys.");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="sort-title" sx={{ width: 560, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="sort-title" level="title-lg">
          Sort range
        </Typography>
        <FormControl error={!!error}>
          <FormLabel>Range</FormLabel>
          <Input
            value={rangeText}
            onChange={(e) => {
              setRangeText(e.target.value);
              setError("");
            }}
            slotProps={{ input: { "aria-label": "Range to sort" } }}
          />
          {error && <FormHelperText>{error}</FormHelperText>}
        </FormControl>
        <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap">
          <Checkbox label="Data has header row" checked={header} onChange={(e) => setHeader(e.target.checked)} />
          <Checkbox label="Case sensitive" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          <RadioGroup
            orientation="horizontal"
            value={orientation}
            onChange={(e) => {
              const o = e.target.value as "rows" | "columns";
              setOrientation(o);
              if (range) setKeys([{ uid: ++uid, index: o === "rows" ? range.c1 : range.r1, ascending: true, by: "value" }]);
            }}
          >
            <Radio value="rows" label="Top to bottom" />
            <Radio value="columns" label="Left to right" />
          </RadioGroup>
        </Stack>
        <Stack spacing={1}>
          {keys.map((k, i) => (
            <Stack key={k.uid} direction="row" spacing={1} alignItems="center" data-testid="sort-key">
              <Typography level="body-sm" sx={{ width: 64 }}>
                {i === 0 ? "Sort by" : "then by"}
              </Typography>
              <Select
                size="sm"
                value={k.index}
                onChange={(_, v) => v != null && setKey(k.uid, { index: v })}
                sx={{ flex: 1, minWidth: 120 }}
                slotProps={{ button: { "aria-label": `Sort key ${i + 1}` } }}
              >
                {choices.map((c) => (
                  <Option key={c.index} value={c.index}>
                    {c.label}
                  </Option>
                ))}
              </Select>
              <Select
                size="sm"
                value={k.by ?? "value"}
                onChange={(_, v) => v && setKey(k.uid, { by: v as SortKey["by"] })}
                slotProps={{ button: { "aria-label": `Sort on ${i + 1}` } }}
              >
                <Option value="value">Values</Option>
                <Option value="fill">Fill colour</Option>
                <Option value="font">Font colour</Option>
              </Select>
              {k.by && k.by !== "value" ? (
                <Box
                  component="input"
                  type="color"
                  aria-label={`Colour ${i + 1}`}
                  value={k.color ?? "#ffff00"}
                  onChange={(e: any) => setKey(k.uid, { color: e.target.value })}
                  sx={{ width: 36, height: 28, p: 0, border: 0, bgcolor: "transparent" }}
                />
              ) : null}
              <Select
                size="sm"
                value={k.ascending ? "asc" : "desc"}
                onChange={(_, v) => v && setKey(k.uid, { ascending: v === "asc" })}
                slotProps={{ button: { "aria-label": `Order ${i + 1}` } }}
              >
                <Option value="asc">{k.by && k.by !== "value" ? "On top" : "A → Z"}</Option>
                <Option value="desc">{k.by && k.by !== "value" ? "On bottom" : "Z → A"}</Option>
              </Select>
              <IconButton
                size="sm"
                variant="plain"
                aria-label={`Remove sort key ${i + 1}`}
                disabled={keys.length === 1}
                onClick={() => setKeys((ks) => ks.filter((x) => x.uid !== k.uid))}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
        </Stack>
        <Box>
          <Button
            size="sm"
            variant="plain"
            disabled={!choices.length}
            onClick={() =>
              setKeys((ks) => [...ks, { uid: ++uid, index: choices[Math.min(ks.length, choices.length - 1)].index, ascending: true, by: "value" }])
            }
          >
            Add another sort column
          </Button>
        </Box>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Sort</Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
