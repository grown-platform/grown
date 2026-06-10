import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Button,
  Sheet,
  Box,
  CircularProgress,
  IconButton,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  ListDivider,
  Tabs,
  Tab,
  TabList,
  TabPanel,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import GestureIcon from "@mui/icons-material/Gesture";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listWhiteboards,
  createWhiteboard,
  renameWhiteboard,
  trashWhiteboard,
  listWhiteboardsSharedWithMe,
} from "./api";
import { ShareDialog } from "./ShareDialog";
import type { Whiteboard } from "./types";

export function WhiteboardList({ user }: { user: User }) {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Whiteboard[] | null>(null);
  const [shared, setShared] = useState<Whiteboard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [shareId, setShareId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWhiteboards()
      .then((b) => !cancelled && setBoards(b))
      .catch((e) => !cancelled && setError((e as Error).message));
    listWhiteboardsSharedWithMe()
      .then((b) => !cancelled && setShared(b))
      .catch(() => !cancelled && setShared([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate() {
    setCreating(true);
    try {
      const b = await createWhiteboard();
      navigate(`/whiteboard/d/${b.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }
  async function onTrash(id: string) {
    await trashWhiteboard(id);
    setBoards((cur) => (cur ?? []).filter((b) => b.id !== id));
  }
  async function onRename(b: Whiteboard) {
    const t = window.prompt("Rename whiteboard", b.title);
    if (t && t !== b.title) {
      const updated = await renameWhiteboard(b.id, t);
      setBoards((cur) => (cur ?? []).map((x) => (x.id === b.id ? updated : x)));
    }
  }

  function BoardRow({ b, owned }: { b: Whiteboard; owned: boolean }) {
    return (
      <Box
        key={b.id}
        data-testid={`whiteboard-${b.id}`}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.25,
          cursor: "pointer",
          borderTop: "1px solid",
          borderColor: "divider",
          "&:first-of-type": { borderTop: "none" },
          "&:hover": { bgcolor: "background.level1" },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flex: 1,
            minWidth: 0,
          }}
          onClick={() => navigate(`/whiteboard/d/${b.id}`)}
        >
          <GestureIcon sx={{ color: "#C46B45" }} />
          <Typography level="body-sm" noWrap sx={{ flex: 1, fontWeight: 500 }}>
            {b.title}
          </Typography>
          <Typography
            level="body-xs"
            sx={{ opacity: 0.6, width: 110, textAlign: "right" }}
          >
            {new Date(b.updated_at).toLocaleDateString()}
          </Typography>
        </Box>
        {owned ? (
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: { size: "sm", variant: "plain", "aria-label": "More" },
              }}
            >
              <MoreVertIcon />
            </MenuButton>
            <Menu size="sm" placement="bottom-end">
              <MenuItem onClick={() => onRename(b)}>Rename</MenuItem>
              <MenuItem
                onClick={() => window.open(`/whiteboard/d/${b.id}`, "_blank")}
              >
                Open in new tab
              </MenuItem>
              <MenuItem onClick={() => setShareId(b.id)}>Share</MenuItem>
              <ListDivider />
              <MenuItem color="danger" onClick={() => onTrash(b.id)}>
                Remove
              </MenuItem>
            </Menu>
          </Dropdown>
        ) : (
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Open in new tab"
            onClick={() => window.open(`/whiteboard/d/${b.id}`, "_blank")}
          >
            <MoreVertIcon />
          </IconButton>
        )}
      </Box>
    );
  }

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
          <Typography level="h2" sx={{ flex: 1 }}>
            Whiteboard
          </Typography>
          <Button
            startDecorator={<AddIcon />}
            loading={creating}
            onClick={onCreate}
            data-testid="new-whiteboard"
          >
            New whiteboard
          </Button>
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">
              Couldn't load whiteboards: {error}
            </Typography>
          </Sheet>
        )}

        <Tabs defaultValue={0}>
          <TabList>
            <Tab>My whiteboards</Tab>
            <Tab>
              Shared with me{" "}
              {shared && shared.length > 0 ? `(${shared.length})` : ""}
            </Tab>
          </TabList>

          <TabPanel value={0} sx={{ px: 0 }}>
            {boards === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {boards !== null && boards.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 4, borderRadius: "md", textAlign: "center", mt: 2 }}
              >
                <Typography level="body-lg" sx={{ opacity: 0.7 }}>
                  No whiteboards yet. Create your first one.
                </Typography>
              </Sheet>
            )}
            {boards !== null && boards.length > 0 && (
              <Sheet
                variant="outlined"
                sx={{ borderRadius: "md", overflow: "hidden", mt: 2 }}
              >
                {boards.map((b) => (
                  <BoardRow key={b.id} b={b} owned={true} />
                ))}
              </Sheet>
            )}
          </TabPanel>

          <TabPanel value={1} sx={{ px: 0 }}>
            {shared === null && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {shared !== null && shared.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 4, borderRadius: "md", textAlign: "center", mt: 2 }}
              >
                <Typography level="body-lg" sx={{ opacity: 0.7 }}>
                  No whiteboards shared with you yet.
                </Typography>
              </Sheet>
            )}
            {shared !== null && shared.length > 0 && (
              <Sheet
                variant="outlined"
                sx={{ borderRadius: "md", overflow: "hidden", mt: 2 }}
              >
                {shared.map((b) => (
                  <BoardRow key={b.id} b={b} owned={false} />
                ))}
              </Sheet>
            )}
          </TabPanel>
        </Tabs>
      </Container>

      {shareId && (
        <ShareDialog
          open={true}
          onClose={() => setShareId(null)}
          boardId={shareId}
        />
      )}
    </>
  );
}
