import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  Modal,
  ModalClose,
  ModalDialog,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/joy";
import { hasCopy, pasteSpecialHere } from "./editActions";
import type { PasteOperation, PasteWhat } from "./pasteSpecial";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Edit ▸ Paste special ▸ Paste special…: Excel's dialog over the cells last
// copied in this editor (what to paste, an arithmetic operation, skip blanks,
// transpose), pasted at the selection.

const WHAT: [PasteWhat, string][] = [
  ["all", "All"],
  ["formulas", "Formulas"],
  ["values", "Values"],
  ["formats", "Formats"],
];
const OPS: [PasteOperation, string][] = [
  ["none", "None"],
  ["add", "Add"],
  ["subtract", "Subtract"],
  ["multiply", "Multiply"],
  ["divide", "Divide"],
];

export function PasteSpecialDialog({ open, onClose, getWb }: { open: boolean; onClose: () => void; getWb: () => any }) {
  const [what, setWhat] = useState<PasteWhat>("all");
  const [operation, setOperation] = useState<PasteOperation>("none");
  const [skipBlanks, setSkipBlanks] = useState(false);
  const [transpose, setTranspose] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWhat("all");
    setOperation("none");
    setSkipBlanks(false);
    setTranspose(false);
  }, [open]);

  const apply = () => {
    const w = getWb();
    if (w) pasteSpecialHere(w, { what, operation, skipBlanks, transpose });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="paste-special-title" sx={{ width: 420, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="paste-special-title" level="title-lg">
          Paste special
        </Typography>
        {!hasCopy() && <Typography level="body-sm">Copy some cells in this spreadsheet first.</Typography>}
        <Stack direction="row" spacing={4}>
          <FormControl>
            <FormLabel>Paste</FormLabel>
            <RadioGroup value={what} onChange={(e) => setWhat(e.target.value as PasteWhat)}>
              {WHAT.map(([v, l]) => (
                <Radio key={v} value={v} label={l} />
              ))}
            </RadioGroup>
          </FormControl>
          <FormControl>
            <FormLabel>Operation</FormLabel>
            <RadioGroup value={operation} onChange={(e) => setOperation(e.target.value as PasteOperation)}>
              {OPS.map(([v, l]) => (
                <Radio key={v} value={v} label={l} disabled={what === "formats"} />
              ))}
            </RadioGroup>
          </FormControl>
        </Stack>
        <Stack direction="row" spacing={3}>
          <Checkbox label="Skip blanks" checked={skipBlanks} onChange={(e) => setSkipBlanks(e.target.checked)} />
          <Checkbox label="Transpose" checked={transpose} onChange={(e) => setTranspose(e.target.checked)} />
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!hasCopy()}>
            Paste
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
