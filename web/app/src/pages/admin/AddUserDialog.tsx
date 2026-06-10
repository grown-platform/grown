import { useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Stack,
  FormControl,
  FormLabel,
  Input,
  Checkbox,
  Button,
  Box,
  Alert,
} from "@mui/joy";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1";
import { createUser, ServiceTokenMissingError } from "./usersApi";

interface AddUserDialogProps {
  onClose: () => void;
  /** Called with the new user id after a successful create. */
  onCreated?: (id: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Shared "Add user" dialog used by the dashboard admin button (and reusable by
 * the Admin console). Provisions a Zitadel human user with a workspace login
 * email plus a required secondary recovery email — the recovery address is where
 * the invite lands, since the workspace mailbox usually doesn't exist yet.
 */
export function AddUserDialog({ onClose, onCreated }: AddUserDialogProps) {
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const emailOk = EMAIL_RE.test(email.trim());
  const recoveryOk = EMAIL_RE.test(recoveryEmail.trim());
  const canSubmit = emailOk && recoveryOk && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createUser({
        givenName: givenName.trim(),
        familyName: familyName.trim(),
        email: email.trim(),
        recoveryEmail: recoveryEmail.trim(),
        sendInvite,
      });
      setDone(true);
      onCreated?.(id);
    } catch (e) {
      if (e instanceof ServiceTokenMissingError) {
        setError(
          "User management isn't configured on the server (missing Zitadel service token).",
        );
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 460 },
          maxWidth: "100vw",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <ModalClose disabled={busy} />
        <Typography level="h4" startDecorator={<PersonAddIcon />}>
          Add user
        </Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Create a workspace account. The invite + recovery link is sent to the
          secondary email.
        </Typography>

        {done ? (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Alert color="success" variant="soft">
              User created
              {sendInvite
                ? " — an invite was sent to the recovery email."
                : "."}
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={onClose}>Done</Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            {error && (
              <Alert color="danger" variant="soft">
                {error}
              </Alert>
            )}
            <Box sx={{ display: "flex", gap: 1 }}>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>First name</FormLabel>
                <Input
                  value={givenName}
                  onChange={(e) => setGivenName(e.target.value)}
                  autoFocus
                />
              </FormControl>
              <FormControl sx={{ flex: 1 }}>
                <FormLabel>Last name</FormLabel>
                <Input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                />
              </FormControl>
            </Box>
            <FormControl error={email.length > 0 && !emailOk}>
              <FormLabel>Workspace email (login)</FormLabel>
              <Input
                type="email"
                placeholder="person@your-org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormControl>
            <FormControl error={recoveryEmail.length > 0 && !recoveryOk}>
              <FormLabel>Recovery email (secondary)</FormLabel>
              <Input
                type="email"
                placeholder="personal@example.com"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
              />
              <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.65 }}>
                Used for account recovery and to deliver the sign-in invite.
              </Typography>
            </FormControl>
            <Checkbox
              label="Send an invite to set up the account"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              sx={{ mt: 0.5 }}
            />
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 1,
              }}
            >
              <Button
                variant="plain"
                color="neutral"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button onClick={submit} loading={busy} disabled={!canSubmit}>
                Create user
              </Button>
            </Box>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}
