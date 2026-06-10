import { useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  FormControl,
  FormLabel,
  Alert,
} from "@mui/joy";
import { changePassword } from "../../api/security";

interface Props {
  userId: string;
  onClose: () => void;
  onDone: () => void;
}

/** ChangePasswordModal collects the current + new password (with confirmation)
 *  and posts the change through the Zitadel proxy. */
export function ChangePasswordModal({ userId, onClose, onDone }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!current || !next) {
      setError("Fill in both password fields");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await changePassword(userId, current, next);
      onDone();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg.includes("400")
          ? "Current password is incorrect or new password too weak."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 420, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography level="h4">Change password</Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <FormControl>
            <FormLabel>Current password</FormLabel>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>New password</FormLabel>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Confirm new password</FormLabel>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FormControl>
          {error && (
            <Alert color="danger" size="sm">
              {error}
            </Alert>
          )}
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy}>
              Update password
            </Button>
          </Box>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
