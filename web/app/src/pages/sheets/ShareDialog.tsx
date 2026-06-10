import { Modal, ModalDialog, ModalClose, Typography, Stack } from "@mui/joy";
import { PeopleGrants } from "../../components/PeopleGrants";
import { listSheetGrants, grantSheetAccess, revokeSheetAccess } from "./api";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  sheetId: string;
}

/** ShareDialog shares a spreadsheet with specific people via per-user ACL grants
 *  (works cross-org, including personal accounts). */
export function ShareDialog({ open, onClose, sheetId }: ShareDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 520 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Share spreadsheet</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Share with specific people by name or email.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {open && (
            <PeopleGrants
              listGrants={() => listSheetGrants(sheetId)}
              grantAccess={async (uid, r) =>
                (await grantSheetAccess(sheetId, uid, r)).grant
              }
              revokeAccess={(uid) => revokeSheetAccess(sheetId, uid)}
            />
          )}
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
