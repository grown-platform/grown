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
  CircularProgress,
} from "@mui/joy";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import {
  startPasskeyRegistration,
  verifyPasskeyRegistration,
} from "../../api/security";
import { transformCredentialCreationOptions } from "../../utils/webauthn";

interface Props {
  userId: string;
  onClose: () => void;
  onDone: () => void;
}

type Step = "name" | "registering" | "error";

/** RegisterPasskeyModal names then registers a WebAuthn passkey: it starts
 *  registration server-side, calls navigator.credentials.create(), and verifies
 *  the attestation back to Zitadel via the proxy. */
export function RegisterPasskeyModal({ userId, onClose, onDone }: Props) {
  const supported =
    typeof window !== "undefined" && !!window.PublicKeyCredential;
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give this passkey a name");
      return;
    }
    setStep("registering");
    try {
      const { passkeyId, publicKeyCredentialCreationOptions } =
        await startPasskeyRegistration(userId);
      const options = transformCredentialCreationOptions(
        publicKeyCredentialCreationOptions,
      );
      const credential = (await navigator.credentials.create({
        publicKey: options,
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("Registration was cancelled");
      await verifyPasskeyRegistration(
        userId,
        passkeyId,
        credential,
        name.trim(),
      );
      onDone();
      onClose();
    } catch (e) {
      const err = e as Error;
      setStep("error");
      if (err.name === "NotAllowedError")
        setError("Registration was cancelled or timed out");
      else if (err.name === "InvalidStateError")
        setError("This device is already registered");
      else setError(err.message);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 420, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography level="h4" startDecorator={<FingerprintIcon />}>
          Add a passkey
        </Typography>

        {!supported ? (
          <>
            <Alert color="danger" size="sm" sx={{ mt: 1 }}>
              Your browser does not support passkeys. Use a recent Chrome,
              Safari, Firefox, or Edge.
            </Alert>
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
              <Button variant="plain" color="neutral" onClick={onClose}>
                Close
              </Button>
            </Box>
          </>
        ) : step === "registering" ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              py: 4,
            }}
          >
            <CircularProgress />
            <Typography
              level="body-sm"
              sx={{ textAlign: "center", opacity: 0.8 }}
            >
              Follow your browser or device prompt to finish.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              Passkeys let you sign in with your fingerprint, face, or security
              key.
            </Typography>
            <FormControl>
              <FormLabel>Passkey name</FormLabel>
              <Input
                autoFocus
                value={name}
                placeholder="e.g. MacBook Touch ID, YubiKey"
                onChange={(e) => setName(e.target.value)}
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
              <Button onClick={register}>
                {step === "error" ? "Try again" : "Register passkey"}
              </Button>
            </Box>
          </Box>
        )}
      </ModalDialog>
    </Modal>
  );
}
