import { Modal, ModalDialog, ModalClose, Typography, Stack } from "@mui/joy";
import { PeopleGrants } from "../../components/PeopleGrants";
import { listDeckGrants, grantDeckAccess, revokeDeckAccess } from "./api";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  deckId: string;
}

/** ShareDialog shares a presentation with specific people via per-user ACL
 *  grants (works cross-org, including personal accounts). */
export function ShareDialog({ open, onClose, deckId }: ShareDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 520 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Share presentation</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Share with specific people by name or email.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {open && (
            <PeopleGrants
              listGrants={() => listDeckGrants(deckId)}
              grantAccess={async (uid, r) =>
                (await grantDeckAccess(deckId, uid, r)).grant
              }
              revokeAccess={(uid) => revokeDeckAccess(deckId, uid)}
            />
          )}
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
