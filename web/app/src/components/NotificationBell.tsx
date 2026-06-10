import { useState, useEffect, useCallback } from "react";
import {
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  IconButton,
  Typography,
  ListDivider,
  Badge,
  Box,
  CircularProgress,
} from "@mui/joy";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import { useNavigate } from "react-router-dom";
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  relativeTime,
  type Notification,
} from "../api/notifications";

// Optional VAPID public key enables real Web Push subscription; without it we
// still request permission + register the SW so local notifications work and
// push can be wired later.
const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type Perm = NotificationPermission | "unsupported";

/** NotificationBell shows the in-app notification feed as a dropdown.
 *  The bell badge reflects the unread count from the backend. A separate
 *  section at the bottom lets the user manage Web Push permission. */
export function NotificationBell() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState<Perm>(
    supported ? Notification.permission : "unsupported",
  );

  // In-app feed state.
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Poll unread count periodically so the badge stays fresh.
  const refreshCount = useCallback(() => {
    unreadCount()
      .then(setCount)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 30_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  // Load notifications when the dropdown opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listNotifications(undefined, 20)
      .then((r) => setItems(r.notifications ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function handleClickItem(item: Notification) {
    // Mark as read then navigate.
    if (!item.read) {
      markRead(item.id)
        .then(() => {
          setItems((prev) =>
            prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
          );
          setCount((c) => Math.max(0, c - 1));
        })
        .catch(() => {});
    }
    if (item.target_url) {
      setOpen(false);
      navigate(item.target_url);
    }
  }

  async function handleMarkAll() {
    markAllRead()
      .then(() => {
        setItems((prev) => prev.map((n) => ({ ...n, read: true })));
        setCount(0);
      })
      .catch(() => {});
  }

  // Push-permission helpers (unchanged from original).
  async function enablePush() {
    if (!supported) return;
    let p: NotificationPermission = "default";
    try {
      p = await Notification.requestPermission();
    } catch {
      /* ignore */
    }
    setPerm(p);
    if (p !== "granted") return;
    try {
      const reg =
        "serviceWorker" in navigator
          ? await navigator.serviceWorker.register("/sw.js")
          : null;
      if (reg && VAPID && reg.pushManager) {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            VAPID,
          ) as unknown as BufferSource,
        });
        fetch("/api/v1/push/subscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub),
        }).catch(() => {});
      }
      new Notification("Notifications enabled", {
        body: "You'll get updates from grown-workspace here.",
      });
    } catch {
      /* SW/push not available — permission still granted */
    }
  }

  function testPush() {
    try {
      new Notification("grown-workspace", {
        body: "This is a test notification.",
      });
    } catch {
      /* ignore */
    }
  }

  const bellIcon =
    perm === "granted" ? (
      <NotificationsActiveIcon />
    ) : perm === "denied" ? (
      <NotificationsOffIcon />
    ) : (
      <NotificationsNoneIcon />
    );

  const hasUnread = count > 0;

  return (
    <Dropdown open={open} onOpenChange={(_, isOpen) => setOpen(isOpen)}>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{
          root: {
            variant: "plain",
            color: "neutral",
            "aria-label": "notifications",
          } as never,
        }}
      >
        <Badge
          badgeContent={hasUnread ? count : undefined}
          color="danger"
          size="sm"
          invisible={!hasUnread}
        >
          {bellIcon}
        </Badge>
      </MenuButton>

      <Menu
        placement="bottom-end"
        sx={{
          minWidth: 340,
          maxWidth: 400,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        {/* Header row */}
        <Box
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography level="title-sm">Notifications</Typography>
          {hasUnread && (
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              onClick={handleMarkAll}
              title="Mark all as read"
            >
              <DoneAllIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
        <ListDivider />

        {/* Feed */}
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size="sm" />
          </Box>
        )}
        {!loading && items.length === 0 && (
          <MenuItem disabled>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              No notifications yet
            </Typography>
          </MenuItem>
        )}
        {!loading &&
          items.map((item) => (
            <MenuItem
              key={item.id}
              onClick={() => handleClickItem(item)}
              sx={{
                alignItems: "flex-start",
                gap: 1,
                bgcolor: item.read ? undefined : "primary.softBg",
                "&:hover": {
                  bgcolor: item.read
                    ? "background.level1"
                    : "primary.softHoverBg",
                },
              }}
            >
              {/* Unread dot */}
              <Box sx={{ pt: 0.5, flexShrink: 0 }}>
                {!item.read && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: "primary.500",
                    }}
                  />
                )}
                {item.read && <Box sx={{ width: 8, height: 8 }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  level="body-sm"
                  sx={{ fontWeight: item.read ? 400 : 600 }}
                  noWrap
                >
                  {item.title}
                </Typography>
                {item.body && (
                  <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                    {item.body}
                  </Typography>
                )}
                <Typography level="body-xs" sx={{ opacity: 0.5, mt: 0.25 }}>
                  {relativeTime(item.created_at)}
                </Typography>
              </Box>
            </MenuItem>
          ))}

        {/* Web Push permission section */}
        <ListDivider />
        <MenuItem disabled sx={{ py: 0.5 }}>
          <Typography level="body-xs" sx={{ opacity: 0.6, fontWeight: 600 }}>
            Desktop notifications
          </Typography>
        </MenuItem>
        {perm === "unsupported" && (
          <MenuItem disabled>
            <Typography level="body-xs">
              Not supported in this browser
            </Typography>
          </MenuItem>
        )}
        {perm === "default" && (
          <MenuItem onClick={enablePush}>
            <Typography level="body-xs">Enable push notifications</Typography>
          </MenuItem>
        )}
        {perm === "denied" && (
          <MenuItem disabled sx={{ whiteSpace: "normal", display: "block" }}>
            <Typography level="body-xs" sx={{ fontWeight: 600 }}>
              Push notifications blocked
            </Typography>
            <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.8 }}>
              Click the lock icon in your browser's address bar → Site settings
              → Notifications → Allow.
            </Typography>
          </MenuItem>
        )}
        {perm === "granted" && (
          <MenuItem onClick={testPush}>
            <Typography level="body-xs">Send a test notification</Typography>
          </MenuItem>
        )}
      </Menu>
    </Dropdown>
  );
}
