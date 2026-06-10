import { useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  Sheet,
  CircularProgress,
  Alert,
} from "@mui/joy";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import QRCode from "qrcode";
import {
  startTotpRegistration,
  verifyTotpRegistration,
} from "../../api/security";

interface Props {
  userId: string;
  onClose: () => void;
  /** Called after a successful verify so the parent can refresh its view. */
  onDone: () => void;
}

type Step = "setup" | "verify";

/** SetupTotpModal walks the user through enrolling an authenticator app:
 *  render the otpauth:// QR (+ manual secret), then verify a 6-digit code. */
export function SetupTotpModal({ userId, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>("setup");
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    startTotpRegistration(userId)
      .then(async (data) => {
        if (cancelled) return;
        setSecret(data.secret);
        const url = await QRCode.toDataURL(data.uri, {
          width: 200,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(
        (e: Error) =>
          !cancelled && setError(`Failed to start setup: ${e.message}`),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const copySecret = async () => {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const verify = async () => {
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setVerifying(true);
    try {
      await verifyTotpRegistration(userId, code);
      onDone();
      onClose();
    } catch (e) {
      setCode("");
      const msg = (e as Error).message;
      setError(msg.includes("400") ? "Invalid code, try again." : msg);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 420, maxWidth: "95vw" }}>
        <ModalClose />
        <Typography level="h4">Set up authenticator app</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1 }}>
          {step === "setup"
            ? "Scan this QR code with Google Authenticator, 1Password, or similar."
            : "Enter the 6-digit code from your authenticator app."}
        </Typography>

        {error && (
          <Alert color="danger" size="sm" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        {step === "setup" ? (
          loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="TOTP QR code"
                  width={200}
                  height={200}
                />
              )}
              {secret && (
                <Box sx={{ width: "100%" }}>
                  <Typography level="body-xs" sx={{ mb: 0.5, opacity: 0.7 }}>
                    Can&apos;t scan? Enter this code:
                  </Typography>
                  <Sheet
                    variant="outlined"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      px: 1.5,
                      py: 1,
                      borderRadius: "sm",
                    }}
                  >
                    <Typography fontFamily="monospace" level="body-sm">
                      {secret}
                    </Typography>
                    <Button
                      size="sm"
                      variant="plain"
                      color="neutral"
                      onClick={copySecret}
                      startDecorator={<ContentCopyIcon sx={{ fontSize: 16 }} />}
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </Sheet>
                </Box>
              )}
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 1,
                  width: "100%",
                  mt: 1,
                }}
              >
                <Button variant="plain" color="neutral" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={() => setStep("verify")} disabled={!secret}>
                  Next
                </Button>
              </Box>
            </Box>
          )
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Input
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              slotProps={{ input: { inputMode: "numeric", maxLength: 6 } }}
              sx={{
                fontFamily: "monospace",
                fontSize: 20,
                letterSpacing: 4,
                textAlign: "center",
              }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
              <Button
                variant="plain"
                color="neutral"
                onClick={() => setStep("setup")}
              >
                Back
              </Button>
              <Button
                onClick={verify}
                loading={verifying}
                disabled={code.length !== 6}
              >
                Verify
              </Button>
            </Box>
          </Box>
        )}
      </ModalDialog>
    </Modal>
  );
}
