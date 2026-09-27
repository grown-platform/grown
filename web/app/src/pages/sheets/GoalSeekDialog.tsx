import { useEffect, useState } from "react";
import { Alert, Button, FormControl, FormLabel, Input, Modal, ModalClose, ModalDialog, Stack, Typography } from "@mui/joy";
import type { GoalSeekResult } from "./api";

// Data ▸ What-if analysis ▸ Goal seek: "Set cell" (a formula) "To value" "By
// changing cell" (a constant). The search runs on the server engine over the
// live workbook; the status step shows what it found, and OK writes the value
// into the changing cell as an ordinary (undoable) edit, Cancel leaves the
// sheet as it was.

export interface GoalSeekRequestUI {
  formulaCell: string;
  target: number;
  changingCell: string;
}

export function GoalSeekDialog({
  open,
  onClose,
  initialCell,
  run,
  apply,
}: {
  open: boolean;
  onClose: () => void;
  /** The active cell when the dialog opened (prefills "Set cell"). */
  initialCell: string;
  run: (req: GoalSeekRequestUI) => Promise<GoalSeekResult>;
  apply: (res: GoalSeekResult) => void;
}) {
  const [setCell, setSetCell] = useState("");
  const [target, setTarget] = useState("");
  const [changing, setChanging] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GoalSeekResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setSetCell(initialCell);
    setTarget("");
    setChanging("");
    setError("");
    setResult(null);
    setBusy(false);
  }, [open, initialCell]);

  const cellRe = /^('[^']+'|[^!]+!)?\$?[A-Za-z]{1,3}\$?\d+$/;
  const targetNum = Number(target.trim().replace(/,/g, ""));
  const valid = cellRe.test(setCell.trim()) && cellRe.test(changing.trim()) && target.trim() !== "" && Number.isFinite(targetNum);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await run({ formulaCell: setCell.trim(), target: targetNum, changingCell: changing.trim() }));
    } catch (e) {
      setError((e as Error).message || "Goal seek failed");
    } finally {
      setBusy(false);
    }
  }

  const fmt = (v: number | string) => (typeof v === "number" ? String(Number(v.toPrecision(12))) : v);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="goalseek-title" sx={{ width: 400, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="goalseek-title" level="title-lg">
          {result ? "Goal seek status" : "Goal seek"}
        </Typography>
        {!result ? (
          <Stack
            component="form"
            spacing={1.5}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <FormControl>
              <FormLabel>Set cell</FormLabel>
              <Input value={setCell} onChange={(e) => setSetCell(e.target.value)} slotProps={{ input: { "aria-label": "Set cell" } }} />
            </FormControl>
            <FormControl>
              <FormLabel>To value</FormLabel>
              <Input value={target} onChange={(e) => setTarget(e.target.value)} autoFocus slotProps={{ input: { "aria-label": "To value", inputMode: "decimal" } }} />
            </FormControl>
            <FormControl>
              <FormLabel>By changing cell</FormLabel>
              <Input value={changing} onChange={(e) => setChanging(e.target.value)} slotProps={{ input: { "aria-label": "By changing cell" } }} />
            </FormControl>
            {error && (
              <Alert color="danger" variant="soft" role="alert">
                {error}
              </Alert>
            )}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button variant="plain" color="neutral" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid} loading={busy}>
                OK
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5} data-testid="goalseek-status">
            <Typography level="body-sm">
              {result.found
                ? `Goal seeking with cell ${result.formulaCell} found a solution.`
                : `Goal seeking with cell ${result.formulaCell} may not have found a solution.`}
            </Typography>
            <Typography level="body-sm">
              Target value: {fmt(targetNum)}
              <br />
              Current value: {fmt(result.result)}
              <br />
              {result.changingCell}: {fmt(result.value)}
              <br />
              Iterations: {result.iterations}
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button variant="plain" color="neutral" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!result.found}
                onClick={() => {
                  apply(result);
                  onClose();
                }}
              >
                OK
              </Button>
            </Stack>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}
