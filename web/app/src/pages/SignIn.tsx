import { useState, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Avatar,
  Input,
  FormControl,
  FormLabel,
  Divider,
  Alert,
} from "@mui/joy";
import { useBrand } from "../brand/Brand";
import { loginURL } from "../api/client";

const API_BASE = "/api/v1";

/** signInWithPassword posts credentials to the in-app login endpoint. */
async function signInWithPassword(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(`${API_BASE}/auth/login-password`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (resp.ok) return { ok: true };
    if (resp.status === 401)
      return { ok: false, error: "Invalid email or password" };
    return { ok: false, error: `Error ${resp.status}` };
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }
}

/** demoProbe checks whether the demo login is available. */
async function demoProbe(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/auth/demo-login`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { enabled: boolean };
    return !!data.enabled;
  } catch {
    return false;
  }
}

/** signInDemo POSTs to the demo login endpoint (one-click, no password). */
async function signInDemo(): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(`${API_BASE}/auth/demo-login`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (resp.ok) return { ok: true };
    return { ok: false, error: `Demo login failed (${resp.status})` };
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }
}

export function SignIn() {
  const brand = useBrand();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // Check once at mount whether the demo button should be shown.
  useEffect(() => {
    void demoProbe().then(setDemoAvailable);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Please enter your email and password");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await signInWithPassword(username.trim(), password);
    setSubmitting(false);
    if (result.ok) {
      window.location.href = "/";
    } else {
      setError(result.error ?? "Sign in failed");
    }
  }

  async function handleDemo() {
    setDemoLoading(true);
    setError(null);
    const result = await signInDemo();
    setDemoLoading(false);
    if (result.ok) {
      window.location.href = "/";
    } else {
      setError(result.error ?? "Demo login failed");
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        bgcolor: "background.body",
        p: 2,
      }}
    >
      <Card variant="soft" sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent sx={{ alignItems: "center", textAlign: "center", gap: 2 }}>
          {brand.logoSVG ? (
            <Box
              aria-label={brand.productName}
              sx={{ width: 64, height: 64, display: "flex", flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: brand.logoSVG }}
            />
          ) : (
            <Avatar
              variant="solid"
              sx={{
                bgcolor: brand.primaryColor,
                color: "white",
                fontWeight: 700,
                width: 64,
                height: 64,
                fontSize: 28,
              }}
            >
              {brand.productName.charAt(0).toUpperCase()}
            </Avatar>
          )}
          <Typography level="h3">{brand.productName}</Typography>
          <Typography level="body-md" sx={{ opacity: 0.75 }}>
            {brand.tagline}
          </Typography>

          {error && (
            <Alert color="danger" sx={{ width: "100%", textAlign: "left" }}>
              {error}
            </Alert>
          )}

          {/* In-app password form */}
          <Box
            component="form"
            onSubmit={handleSubmit}
            sx={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              mt: 1,
            }}
          >
            <FormControl sx={{ width: "100%", textAlign: "left" }}>
              <FormLabel>Email</FormLabel>
              <Input
                type="email"
                placeholder="you@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={submitting}
                data-testid="username-input"
              />
            </FormControl>
            <FormControl sx={{ width: "100%", textAlign: "left" }}>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={submitting}
                data-testid="password-input"
              />
            </FormControl>
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              sx={{
                bgcolor: brand.primaryColor,
                alignSelf: "stretch",
                mt: 0.5,
              }}
              data-testid="sign-in-button"
            >
              Sign in
            </Button>
          </Box>

          {/* Demo one-click button */}
          {demoAvailable && (
            <Button
              variant="outlined"
              color="neutral"
              size="lg"
              loading={demoLoading}
              onClick={handleDemo}
              sx={{ alignSelf: "stretch" }}
              data-testid="demo-button"
            >
              View Demo
            </Button>
          )}

          {/* SSO fallback */}
          <Divider sx={{ width: "100%", mt: 1 }}>
            <Typography level="body-xs" sx={{ opacity: 0.5 }}>
              or
            </Typography>
          </Divider>
          <Button
            component="a"
            href={loginURL()}
            variant="outlined"
            color="neutral"
            size="md"
            sx={{ alignSelf: "stretch" }}
            data-testid="sso-button"
          >
            Sign in with SSO
          </Button>
        </CardContent>
      </Card>
      <Typography
        component="a"
        href="/docs"
        level="body-sm"
        sx={{
          color: "text.tertiary",
          textDecoration: "none",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        Documentation
      </Typography>
    </Box>
  );
}
