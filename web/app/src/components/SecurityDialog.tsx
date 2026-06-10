import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Avatar,
  Sheet,
  Button,
  Divider,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  List,
  ListItem,
} from "@mui/joy";
import SecurityIcon from "@mui/icons-material/Security";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import PhonelinkLockIcon from "@mui/icons-material/PhonelinkLock";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import type { User } from "../api/types";
import {
  getUserSecurityInfo,
  deleteTotpFactor,
  deletePasskey,
  type UserSecurityInfo,
} from "../api/security";
import { SetupTotpModal } from "./security/SetupTotpModal";
import { RegisterPasskeyModal } from "./security/RegisterPasskeyModal";
import { ChangePasswordModal } from "./security/ChangePasswordModal";

/** SecurityDialog is grown's in-app account security panel. It manages the
 *  signed-in user's authenticator app, passkeys, and password directly via the
 *  Zitadel User API v2 (proxied by the backend), instead of deep-linking to the
 *  Zitadel console. The userId for every call is the user's own oidc_subject;
 *  the backend enforces that callers can only touch their own account. */
export function SecurityDialog({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const userId = user.oidc_subject;
  const [info, setInfo] = useState<UserSecurityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<null | "totp" | "passkey" | "password">(
    null,
  );

  const load = useCallback(() => {
    if (!userId) {
      setError("Account id unavailable.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getUserSecurityInfo(userId)
      .then(setInfo)
      .catch((e: Error) =>
        setError(`Couldn't load security settings: ${e.message}`),
      )
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(load, [load]);

  const initial = (user.display_name || user.email || "?")
    .charAt(0)
    .toUpperCase();

  const removeTotp = async () => {
    if (
      !confirm(
        "Remove your authenticator app? You'll need to set it up again to use it.",
      )
    )
      return;
    try {
      await deleteTotpFactor(userId);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const removePasskey = async (id: string, name: string) => {
    if (!confirm(`Remove passkey "${name}"?`)) return;
    try {
      await deletePasskey(userId, id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <Modal open onClose={onClose}>
        <ModalDialog
          sx={{
            width: 540,
            maxWidth: "95vw",
            maxHeight: "90vh",
            overflow: "auto",
          }}
        >
          <ModalClose />
          <Typography level="h4" startDecorator={<SecurityIcon />}>
            Security
          </Typography>

          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 1.5 }}
          >
            <Avatar sx={{ "--Avatar-size": "48px" }}>{initial}</Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography level="title-md">
                {user.display_name || user.email}
              </Typography>
              <Typography
                level="body-sm"
                sx={{ opacity: 0.7 }}
                startDecorator={
                  info?.emailVerified ? (
                    <CheckCircleIcon color="success" sx={{ fontSize: 15 }} />
                  ) : undefined
                }
              >
                {user.email}
              </Typography>
            </Box>
          </Box>
          <Divider />

          {error && (
            <Alert color="danger" size="sm" sx={{ mt: 1.5 }}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
                mt: 1.5,
              }}
            >
              {/* Authenticator app */}
              <Sheet variant="outlined" sx={{ p: 1.5, borderRadius: "sm" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <PhonelinkLockIcon />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="title-sm">Authenticator app</Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      Time-based one-time codes (TOTP) for two-step
                      verification.
                    </Typography>
                  </Box>
                  {info?.hasTotp ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Chip size="sm" color="success" variant="soft">
                        Enabled
                      </Chip>
                      <IconButton
                        size="sm"
                        color="danger"
                        variant="plain"
                        aria-label="Remove authenticator"
                        onClick={removeTotp}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Box>
                  ) : (
                    <Button
                      size="sm"
                      variant="outlined"
                      startDecorator={<AddIcon />}
                      onClick={() => setActive("totp")}
                    >
                      Add
                    </Button>
                  )}
                </Box>
              </Sheet>

              {/* Passkeys */}
              <Sheet variant="outlined" sx={{ p: 1.5, borderRadius: "sm" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <FingerprintIcon />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="title-sm">Passkeys</Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      Sign in with your fingerprint, face, or a security key.
                    </Typography>
                  </Box>
                  <Button
                    size="sm"
                    variant="outlined"
                    startDecorator={<AddIcon />}
                    onClick={() => setActive("passkey")}
                  >
                    Add
                  </Button>
                </Box>
                {info && info.passkeys.length > 0 && (
                  <List size="sm" sx={{ mt: 1, "--ListItem-paddingY": "4px" }}>
                    {info.passkeys.map((pk) => (
                      <ListItem
                        key={pk.id}
                        endAction={
                          <IconButton
                            size="sm"
                            color="danger"
                            variant="plain"
                            aria-label={`Remove ${pk.name}`}
                            onClick={() => removePasskey(pk.id, pk.name)}
                          >
                            <DeleteOutlineIcon />
                          </IconButton>
                        }
                      >
                        <FingerprintIcon sx={{ fontSize: 16, opacity: 0.6 }} />
                        <Typography level="body-sm">
                          {pk.name || "Unnamed passkey"}
                        </Typography>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Sheet>

              {/* Password */}
              <Sheet
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: "sm",
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                <VpnKeyIcon />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography level="title-sm">Password</Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                    {info?.hasPassword
                      ? "Change the password you use to sign in."
                      : "No password set for this account."}
                  </Typography>
                </Box>
                <Button
                  size="sm"
                  variant="outlined"
                  color="neutral"
                  onClick={() => setActive("password")}
                  disabled={!info?.hasPassword}
                >
                  Change
                </Button>
              </Sheet>
            </Box>
          )}

          <Chip size="sm" variant="soft" sx={{ mt: 1.5 }}>
            Your sign-in and account security are managed here, backed by your
            organization&apos;s identity provider.
          </Chip>
        </ModalDialog>
      </Modal>

      {active === "totp" && (
        <SetupTotpModal
          userId={userId}
          onClose={() => setActive(null)}
          onDone={load}
        />
      )}
      {active === "passkey" && (
        <RegisterPasskeyModal
          userId={userId}
          onClose={() => setActive(null)}
          onDone={load}
        />
      )}
      {active === "password" && (
        <ChangePasswordModal
          userId={userId}
          onClose={() => setActive(null)}
          onDone={load}
        />
      )}
    </>
  );
}
