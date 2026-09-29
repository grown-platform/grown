import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Sheet,
  Tooltip,
  Typography,
} from "@mui/joy";
import { Link as RouterLink } from "react-router-dom";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import SensorsRoundedIcon from "@mui/icons-material/SensorsRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { useServiceSettings } from "../../catalog/serviceSettings";
import {
  HA_FRAME_CONFIG,
  HA_SIGNIN_WINDOW,
  embedBlockReason,
  resolveHomeAssistantUrl,
  signInPopupFeatures,
} from "./embed";

// How long to wait for the frame's load event before offering the fallback.
const LOAD_TIMEOUT_MS = 15000;

/** HomeAssistantApp frames the org's Home Assistant (its Admin > Services /
 *  Settings URL, or the chart's GROWN_HOMEASSISTANT_URL default) under grown's
 *  header. HA only allows framing with `http: use_x_frame_options: false`, and
 *  a refusal can't be detected from script, so the "open in new tab" escape
 *  hatch and the how-to are always one click away. */
export default function HomeAssistantApp({ user }: { user: User }) {
  const settings = useServiceSettings(true);
  const haUrl = useMemo(() => resolveHomeAssistantUrl(settings), [settings]);
  const block = haUrl ? embedBlockReason(haUrl, window.location.protocol) : null;
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const popupRef = useRef<Window | null>(null);

  // Single sign-on pages refuse to be framed, so HA's SSO login runs in a
  // popup. It's cross-origin (we can't see when login finishes), so reload the
  // frame when the popup closes, or when the user comes back to this tab.
  const signIn = useCallback(() => {
    if (!haUrl) return;
    const w = window.open(haUrl, HA_SIGNIN_WINDOW, signInPopupFeatures(window.screen));
    if (!w) {
      // Popup blocked: fall back to a normal tab.
      window.open(haUrl, "_blank", "noopener");
      return;
    }
    popupRef.current = w;
    w.focus();
  }, [haUrl]);

  useEffect(() => {
    const reloadIfDone = () => {
      const w = popupRef.current;
      if (w && w.closed) {
        popupRef.current = null;
        setReloadKey((k) => k + 1);
      }
    };
    const onFocus = () => {
      if (popupRef.current) setReloadKey((k) => k + 1);
    };
    const t = window.setInterval(reloadIfDone, 700);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    document.title = "Home Assistant";
  }, []);

  useEffect(() => {
    if (!haUrl || block) return;
    setLoaded(false);
    setTimedOut(false);
    const t = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [haUrl, block, reloadKey]);

  let body: React.ReactNode;
  if (settings === undefined) {
    body = (
      <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  } else if (!haUrl) {
    body = (
      <Centered>
        <Typography level="title-lg">Home Assistant isn't set up</Typography>
        <Typography level="body-md" sx={{ mt: 1 }}>
          {settings === null
            ? "Couldn't load this organization's service settings."
            : "Your organization hasn't configured a Home Assistant URL (or has turned it off)."}{" "}
          An admin sets it in{" "}
          <Link component={RouterLink} to="/admin/services">
            Admin &gt; Services
          </Link>{" "}
          (personal accounts: <Link component={RouterLink} to="/settings">Settings</Link>).
        </Typography>
      </Centered>
    );
  } else if (block === "mixed-content") {
    body = (
      <Centered>
        <Typography level="title-lg">Home Assistant can't be shown here</Typography>
        <Typography level="body-md" sx={{ mt: 1 }}>
          Grown is served over HTTPS but your Home Assistant URL is plain HTTP,
          and browsers block insecure pages inside secure ones. Give Home
          Assistant an HTTPS URL, or open it in its own tab.
        </Typography>
        <OpenButton href={haUrl} sx={{ mt: 2 }} />
      </Centered>
    );
  } else {
    body = (
      <Box sx={{ flex: 1, position: "relative", minHeight: 0 }}>
        {showHelp || (timedOut && !loaded) ? (
          <FrameHelp
            haUrl={haUrl}
            timedOut={timedOut && !loaded}
            onClose={() => setShowHelp(false)}
          />
        ) : null}
        {!loaded && !timedOut && (
          <Box
            sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}
          >
            <CircularProgress />
          </Box>
        )}
        <Box
          component="iframe"
          key={reloadKey}
          src={haUrl}
          title="Home Assistant"
          data-testid="homeassistant-frame"
          onLoad={() => setLoaded(true)}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="fullscreen; clipboard-read; clipboard-write; microphone; camera; geolocation"
          sx={{ border: 0, width: "100%", height: "100%", display: "block", bgcolor: "background.surface" }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100dvh", display: "flex", flexDirection: "column", bgcolor: "background.body" }}>
      <Header user={user} />
      {haUrl && (
        <Sheet
          variant="soft"
          sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <SensorsRoundedIcon sx={{ color: "#18BCF2" }} />
          <Typography level="body-sm" noWrap sx={{ flex: 1, minWidth: 0, opacity: 0.75 }} data-testid="homeassistant-url">
            {haUrl}
          </Typography>
          {!block && (
            <>
              <Tooltip title="Sign in (single sign-on can't open inside Grown, so it opens in a popup; this view reloads when you're done)">
                <Button
                  size="sm"
                  variant="plain"
                  startDecorator={<LoginRoundedIcon />}
                  onClick={signIn}
                  data-testid="homeassistant-sign-in"
                >
                  Sign in
                </Button>
              </Tooltip>
              <Tooltip title="Not loading? How to allow embedding">
                <IconButton size="sm" variant="plain" aria-label="Embedding help" onClick={() => setShowHelp((v) => !v)}>
                  <HelpOutlineIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Reload">
                <IconButton size="sm" variant="plain" aria-label="Reload Home Assistant" onClick={() => setReloadKey((k) => k + 1)}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
          <OpenButton href={haUrl} />
        </Sheet>
      )}
      {body}
    </Box>
  );
}

function OpenButton({ href, sx }: { href: string; sx?: object }) {
  return (
    <Button
      size="sm"
      variant="outlined"
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      startDecorator={<OpenInNewIcon />}
      data-testid="homeassistant-open-new-tab"
      sx={sx}
    >
      Open in new tab
    </Button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 3 }}>
      <Box sx={{ maxWidth: 560, textAlign: "center" }} data-testid="homeassistant-fallback">
        {children}
      </Box>
    </Box>
  );
}

function FrameHelp({ haUrl, timedOut, onClose }: { haUrl: string; timedOut: boolean; onClose: () => void }) {
  return (
    <Alert
      color={timedOut ? "warning" : "neutral"}
      variant="soft"
      data-testid="homeassistant-fallback"
      sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2, maxWidth: 620, width: "calc(100% - 24px)", alignItems: "flex-start", boxShadow: "md" }}
      endDecorator={
        !timedOut && (
          <Button size="sm" variant="plain" color="neutral" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <Box>
        <Typography level="title-sm">
          {timedOut ? "Home Assistant is taking a while to load" : "Blank or “refused to connect”?"}
        </Typography>
        <Typography level="body-sm" sx={{ mt: 0.5 }}>
          Home Assistant refuses to be shown inside other sites unless you allow
          it. Add this to its <code>configuration.yaml</code> and restart Home
          Assistant (the Grown Helm chart does this for you):
        </Typography>
        <Box component="pre" sx={{ my: 1, p: 1, borderRadius: "sm", bgcolor: "background.level1", fontSize: "sm" }}>
          {HA_FRAME_CONFIG}
        </Box>
        <Typography level="body-sm">
          Stuck on a spinner at sign-in? Single sign-on pages can't be shown
          inside other sites; use <strong>Sign in</strong> in the bar above,
          which signs you in through a popup. Also check the URL is reachable
          from this browser, or{" "}
          <Link href={haUrl} target="_blank" rel="noopener noreferrer">
            open Home Assistant in a new tab
          </Link>
          .
        </Typography>
      </Box>
    </Alert>
  );
}
