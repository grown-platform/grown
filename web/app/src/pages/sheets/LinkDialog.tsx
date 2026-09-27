import { useEffect, useState } from "react";
import { Button, FormControl, FormLabel, Input, Modal, ModalClose, ModalDialog, Stack, Typography } from "@mui/joy";

// Insert ▸ Link (Ctrl+K): text and address for the active cell. The address
// is a web link (http, https, mailto) or an in-workbook reference such as
// Sheet2!A1.

export interface LinkValue {
  text: string;
  address: string;
  type: "webpage" | "cellrange";
}

export function normalizeLinkAddress(raw: string): { address: string; type: LinkValue["type"] } | null {
  const a = raw.trim();
  if (!a) return null;
  if (/^(https?:|mailto:)/i.test(a)) return { address: a, type: "webpage" };
  if (/^[^\s!]+![A-Za-z]{1,3}\d+$/.test(a) || /^'[^']+'![A-Za-z]{1,3}\d+$/.test(a)) return { address: a, type: "cellrange" };
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(a)) return { address: `https://${a}`, type: "webpage" };
  return null;
}

export function LinkDialog({
  open,
  onClose,
  initialText,
  initialAddress,
  onApply,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  initialText: string;
  initialAddress: string;
  onApply: (v: LinkValue) => void;
  onRemove?: () => void;
}) {
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  useEffect(() => {
    if (open) {
      setText(initialText);
      setAddress(initialAddress);
    }
  }, [open, initialText, initialAddress]);
  const norm = normalizeLinkAddress(address);
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="link-title" sx={{ width: 420, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography id="link-title" level="title-lg">
          Insert link
        </Typography>
        <Stack
          component="form"
          spacing={1.5}
          onSubmit={(e) => {
            e.preventDefault();
            if (!norm) return;
            onApply({ text: text.trim() || norm.address, address: norm.address, type: norm.type });
            onClose();
          }}
        >
          <FormControl>
            <FormLabel>Text</FormLabel>
            <Input value={text} onChange={(e) => setText(e.target.value)} slotProps={{ input: { "aria-label": "Link text" } }} />
          </FormControl>
          <FormControl>
            <FormLabel>Link</FormLabel>
            <Input
              value={address}
              autoFocus
              placeholder="https://… or Sheet2!A1"
              onChange={(e) => setAddress(e.target.value)}
              slotProps={{ input: { "aria-label": "Link address" } }}
            />
          </FormControl>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {onRemove && initialAddress && (
              <Button variant="plain" color="danger" onClick={() => { onRemove(); onClose(); }}>
                Remove link
              </Button>
            )}
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!norm}>
              Apply
            </Button>
          </Stack>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
