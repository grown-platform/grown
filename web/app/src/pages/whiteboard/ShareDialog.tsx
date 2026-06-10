import { Modal, ModalDialog, ModalClose, Typography, Stack } from "@mui/joy";
import { PeopleGrants } from "../../components/PeopleGrants";
import { listBoardGrants, grantBoardAccess, revokeBoardAccess } from "./api";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
}

/** ShareDialog shares a whiteboard with specific people via per-user ACL grants
 *  (works cross-org, including personal accounts). */
export function ShareDialog({ open, onClose, boardId }: ShareDialogProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 520 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Share whiteboard</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Share with specific people by name or email.
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {open && (
            <PeopleGrants
              listGrants={() => listBoardGrants(boardId)}
              grantAccess={async (uid, r) =>
                (await grantBoardAccess(boardId, uid, r)).grant
              }
              revokeAccess={(uid) => revokeBoardAccess(boardId, uid)}
            />
          )}
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
