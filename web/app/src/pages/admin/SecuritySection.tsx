// SecuritySection — the Admin → Security console, modeled on Google Workspace
// Admin's Security menu (Overview + an Authentication group, plus lighter
// Access-and-data-control / Security-center entries).
//
// The items that map cleanly to Zitadel ORG policies are wired to real GET/PUT
// endpoints (internal/adminsecurity): Password management, 2-step verification,
// Login challenges, Passwordless. The rest are presented as honest "Managed in
// Zitadel" / "Coming soon" cards — no faked functionality. SSO cards read-only
// list the org's existing Zitadel IdPs when available.
//
// Styling matches the other admin sections (Joy UI Sheet/FormControl/Switch/
// Select/Button), with a left sub-nav driving which panel renders.

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Typography,
  Sheet,
  Switch,
  Input,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Chip,
  Alert,
  Divider,
  Button,
  FormControl,
  FormLabel,
  FormHelperText,
  Select,
  Option,
  Checkbox,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import {
  getPolicies,
  getIDPs,
  putPassword,
  putMFA,
  putLockout,
  putPasswordless,
  PASSWORDLESS_OPTIONS,
  SecurityForbiddenError,
  SecurityUnavailableError,
  type PoliciesResponse,
  type IDPsResponse,
} from "./securityApi";

// Sub-nav item ids. The "wired" ids drive real forms; the rest render
// informational cards.
type SubId =
  | "overview"
  | "twostep"
  | "recovery"
  | "advprotect"
  | "challenges"
  | "passwordless"
  | "password"
  | "sso-saml"
  | "sso-idp"
  | "mpa"
  | "access"
  | "center";

interface SubItem {
  id: SubId;
  label: string;
  icon: React.ReactNode;
  group?: string;
}

const SUB_ITEMS: SubItem[] = [
  { id: "overview", label: "Overview", icon: <Icons.Dashboard /> },
  // Authentication group
  {
    id: "twostep",
    label: "2-step verification",
    icon: <Icons.PhonelinkLock />,
    group: "Authentication",
  },
  { id: "recovery", label: "Account recovery", icon: <Icons.RestartAlt />, group: "Authentication" },
  {
    id: "advprotect",
    label: "Advanced Protection Program",
    icon: <Icons.GppMaybe />,
    group: "Authentication",
  },
  { id: "challenges", label: "Login challenges", icon: <Icons.Lock />, group: "Authentication" },
  { id: "passwordless", label: "Passwordless", icon: <Icons.Fingerprint />, group: "Authentication" },
  { id: "password", label: "Password management", icon: <Icons.Password />, group: "Authentication" },
  {
    id: "sso-saml",
    label: "SSO with SAML applications",
    icon: <Icons.AppShortcut />,
    group: "Authentication",
  },
  {
    id: "sso-idp",
    label: "SSO with third-party IdP",
    icon: <Icons.Hub />,
    group: "Authentication",
  },
  { id: "mpa", label: "Multi-party approval", icon: <Icons.Groups />, group: "Authentication" },
  // Top-level lighter entries
  { id: "access", label: "Access and data control", icon: <Icons.Policy /> },
  { id: "center", label: "Security center", icon: <Icons.Security /> },
];

export function SecuritySection() {
  const [sub, setSub] = useState<SubId>("overview");
  const [policies, setPolicies] = useState<PoliciesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setUnavailable(false);
    setLoadError(null);
    try {
      setPolicies(await getPolicies());
    } catch (e) {
      if (e instanceof SecurityForbiddenError) setForbidden(true);
      else if (e instanceof SecurityUnavailableError) setUnavailable(true);
      else setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Security
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to manage security settings. Ask an org
          admin to add your email to <code>GROWN_ADMIN_EMAILS</code>.
        </Alert>
      </>
    );
  }

  if (unavailable) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Security
        </Typography>
        <Alert color="warning" variant="soft">
          Security policy management needs a Zitadel service token. Set{" "}
          <code>GROWN_ZITADEL_SERVICE_TOKEN</code> on the server to enable it.
        </Alert>
      </>
    );
  }

  const grouped: { group?: string; items: SubItem[] }[] = [];
  for (const item of SUB_ITEMS) {
    const last = grouped[grouped.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else grouped.push({ group: item.group, items: [item] });
  }

  return (
    <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
      {/* Sub-nav */}
      <Box sx={{ width: 230, flexShrink: 0, display: { xs: "none", md: "block" } }}>
        <List size="sm" sx={{ "--ListItem-radius": "8px" }}>
          {grouped.map((g, gi) => (
            <Box key={g.group ?? `g${gi}`}>
              {g.group && (
                <Typography
                  level="body-xs"
                  sx={{ px: 1, pt: 1.5, pb: 0.5, opacity: 0.55, textTransform: "uppercase", letterSpacing: 0.5 }}
                >
                  {g.group}
                </Typography>
              )}
              {g.items.map((item) => (
                <ListItem key={item.id}>
                  <ListItemButton
                    selected={sub === item.id}
                    onClick={() => setSub(item.id)}
                    data-testid={`security-nav-${item.id}`}
                  >
                    <ListItemDecorator>{item.icon}</ListItemDecorator>
                    <Box sx={{ flex: 1, fontSize: "sm" }}>{item.label}</Box>
                  </ListItemButton>
                </ListItem>
              ))}
            </Box>
          ))}
        </List>
      </Box>

      {/* Mobile sub-nav select */}
      <Box sx={{ display: { xs: "block", md: "none" }, width: "100%", mb: 2 }}>
        <Select
          size="sm"
          value={sub}
          onChange={(_, v) => v && setSub(v as SubId)}
        >
          {SUB_ITEMS.map((item) => (
            <Option key={item.id} value={item.id}>
              {item.label}
            </Option>
          ))}
        </Select>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
        {loading && !policies ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {loadError && (
              <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
                {loadError}
              </Alert>
            )}
            {sub === "overview" && (
              <OverviewPanel policies={policies} onNavigate={setSub} />
            )}
            {sub === "password" && (
              <PasswordPanel policies={policies} onSaved={load} />
            )}
            {sub === "twostep" && (
              <TwoStepPanel policies={policies} onSaved={load} />
            )}
            {sub === "challenges" && (
              <ChallengesPanel policies={policies} onSaved={load} />
            )}
            {sub === "passwordless" && (
              <PasswordlessPanel policies={policies} onSaved={load} />
            )}
            {sub === "sso-saml" && <SSOPanel mode="saml" />}
            {sub === "sso-idp" && <SSOPanel mode="idp" />}
            {sub === "recovery" && (
              <InfoCard
                title="Account recovery"
                icon={<Icons.RestartAlt />}
                managed
                body="Self-service recovery (recovery email / phone, reset flows) is governed by Zitadel's notification + login settings for your org. Per-user recovery email is captured when an admin creates a user."
              />
            )}
            {sub === "advprotect" && (
              <InfoCard
                title="Advanced Protection Program"
                icon={<Icons.GppMaybe />}
                comingSoon
                body="A hardened profile for high-risk accounts (enforced security keys, stricter session + download controls). Planned: maps to a stricter Zitadel login policy + key-only second factors applied to a designated group."
              />
            )}
            {sub === "mpa" && (
              <InfoCard
                title="Multi-party approval"
                icon={<Icons.Groups />}
                comingSoon
                body="Require a second admin to approve sensitive admin actions (e.g. disabling 2-step, bulk deletes). Planned as a grown-side approval workflow layered over the admin endpoints; not a native Zitadel policy."
              />
            )}
            {sub === "access" && (
              <InfoCard
                title="Access and data control"
                icon={<Icons.Policy />}
                comingSoon
                body="Context-aware access, data regions, and external sharing controls. Some pieces already exist elsewhere in grown (per-service toggles under Services, session revocation under Sessions & logins); a unified policy surface is planned."
              />
            )}
            {sub === "center" && (
              <InfoCard
                title="Security center"
                icon={<Icons.Security />}
                comingSoon
                body="A posture dashboard with alerts and recommendations. The Overview tab already summarizes your current posture from live Zitadel policy; richer alerting is planned."
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

// ---- Overview ---------------------------------------------------------------

function OverviewPanel({
  policies,
  onNavigate,
}: {
  policies: PoliciesResponse | null;
  onNavigate: (id: SubId) => void;
}) {
  const p = policies;
  const mfaOn = p?.login.force_mfa ?? false;
  const minLen = p?.password.min_length ?? 0;
  const lockout = p?.lockout.max_password_attempts ?? 0;
  const passwordless =
    p?.login.passwordless_type === "PASSWORDLESS_TYPE_ALLOWED";

  const items: {
    label: string;
    value: string;
    good: boolean;
    nav: SubId;
  }[] = [
    {
      label: "2-step verification (MFA)",
      value: mfaOn ? "Enforced for all users" : "Not enforced",
      good: mfaOn,
      nav: "twostep",
    },
    {
      label: "Minimum password length",
      value: minLen > 0 ? `${minLen} characters` : "Default",
      good: minLen >= 8,
      nav: "password",
    },
    {
      label: "Account lockout",
      value:
        lockout > 0
          ? `After ${lockout} failed attempts`
          : "No lockout threshold",
      good: lockout > 0,
      nav: "challenges",
    },
    {
      label: "Passwordless (passkeys)",
      value: passwordless ? "Allowed" : "Not allowed",
      good: true,
      nav: "passwordless",
    },
  ];

  return (
    <>
      <PanelHeader
        title="Overview"
        subtitle="Your organization's current security posture, read live from Zitadel."
      />
      <Sheet variant="outlined" sx={{ borderRadius: "md", overflow: "hidden" }}>
        {items.map((it, i) => (
          <Box
            key={it.label}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1.5,
              borderTop: i === 0 ? "none" : "1px solid",
              borderColor: "divider",
            }}
          >
            <Chip
              size="sm"
              variant="soft"
              color={it.good ? "success" : "warning"}
              startDecorator={
                it.good ? (
                  <Icons.CheckCircle sx={{ fontSize: 14 }} />
                ) : (
                  <Icons.Warning sx={{ fontSize: 14 }} />
                )
              }
            >
              {it.good ? "OK" : "Review"}
            </Chip>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography level="body-sm" sx={{ fontWeight: 500 }}>
                {it.label}
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                {it.value}
              </Typography>
            </Box>
            <Button
              size="sm"
              variant="plain"
              onClick={() => onNavigate(it.nav)}
            >
              Manage
            </Button>
          </Box>
        ))}
      </Sheet>
      {p && (
        <Typography level="body-xs" sx={{ opacity: 0.55, mt: 1.5 }}>
          Org {p.org_id} · collected{" "}
          {new Date(p.collected_at).toLocaleString()}
          {(p.password.is_default || p.login.is_default || p.lockout.is_default) && (
            <>
              {" "}
              · some policies still inherit the Zitadel instance default and will
              be created at the org level on first save.
            </>
          )}
        </Typography>
      )}
    </>
  );
}

// ---- Password management (wired) -------------------------------------------

function PasswordPanel({
  policies,
  onSaved,
}: {
  policies: PoliciesResponse | null;
  onSaved: () => Promise<void> | void;
}) {
  const cur = policies?.password;
  const [minLength, setMinLength] = useState(8);
  const [hasUpper, setHasUpper] = useState(false);
  const [hasLower, setHasLower] = useState(false);
  const [hasNumber, setHasNumber] = useState(false);
  const [hasSymbol, setHasSymbol] = useState(false);
  const { saving, error, success, run } = useSaver();

  useEffect(() => {
    if (cur) {
      setMinLength(cur.min_length || 8);
      setHasUpper(cur.has_uppercase);
      setHasLower(cur.has_lowercase);
      setHasNumber(cur.has_number);
      setHasSymbol(cur.has_symbol);
    }
  }, [cur]);

  return (
    <>
      <PanelHeader
        title="Password management"
        subtitle="Complexity requirements applied to every member's password."
        isDefault={cur?.is_default}
      />
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
        <SaveAlerts error={error} success={success} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FormControl sx={{ maxWidth: 220 }}>
            <FormLabel>Minimum length</FormLabel>
            <Input
              type="number"
              value={minLength}
              slotProps={{ input: { min: 1, max: 72 } }}
              onChange={(e) => setMinLength(Number(e.target.value))}
            />
            <FormHelperText>Zitadel allows 1–72 characters.</FormHelperText>
          </FormControl>
          <Checkbox
            label="Require an uppercase letter"
            checked={hasUpper}
            onChange={(e) => setHasUpper(e.target.checked)}
          />
          <Checkbox
            label="Require a lowercase letter"
            checked={hasLower}
            onChange={(e) => setHasLower(e.target.checked)}
          />
          <Checkbox
            label="Require a number"
            checked={hasNumber}
            onChange={(e) => setHasNumber(e.target.checked)}
          />
          <Checkbox
            label="Require a symbol"
            checked={hasSymbol}
            onChange={(e) => setHasSymbol(e.target.checked)}
          />
          <Box>
            <Button
              loading={saving}
              data-testid="security-password-save"
              onClick={() =>
                run(async () => {
                  await putPassword({
                    min_length: minLength,
                    has_uppercase: hasUpper,
                    has_lowercase: hasLower,
                    has_number: hasNumber,
                    has_symbol: hasSymbol,
                  });
                  await onSaved();
                })
              }
            >
              Save
            </Button>
          </Box>
        </Box>
      </Sheet>
    </>
  );
}

// ---- 2-step verification (wired) -------------------------------------------

function TwoStepPanel({
  policies,
  onSaved,
}: {
  policies: PoliciesResponse | null;
  onSaved: () => Promise<void> | void;
}) {
  const cur = policies?.login;
  const [forceMfa, setForceMfa] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const { saving, error, success, run } = useSaver();

  useEffect(() => {
    if (cur) {
      setForceMfa(cur.force_mfa);
      setLocalOnly(cur.force_mfa_local_only);
    }
  }, [cur]);

  return (
    <>
      <PanelHeader
        title="2-step verification"
        subtitle="Require a second factor (OTP / security key) at sign-in. Maps to your Zitadel login policy."
        isDefault={cur?.is_default}
      />
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
        <SaveAlerts error={error} success={success} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <ToggleRow
            label="Enforce 2-step verification"
            help="Every member must set up and use a second factor."
            checked={forceMfa}
            onChange={setForceMfa}
            testid="security-mfa-force"
          />
          <ToggleRow
            label="Local accounts only"
            help="Don't enforce MFA for users signing in via an external IdP."
            checked={localOnly}
            onChange={setLocalOnly}
            disabled={!forceMfa}
          />
          <Box>
            <Button
              loading={saving}
              data-testid="security-mfa-save"
              onClick={() =>
                run(async () => {
                  await putMFA({
                    force_mfa: forceMfa,
                    force_mfa_local_only: localOnly,
                  });
                  await onSaved();
                })
              }
            >
              Save
            </Button>
          </Box>
        </Box>
      </Sheet>
    </>
  );
}

// ---- Login challenges / lockout (wired) ------------------------------------

function ChallengesPanel({
  policies,
  onSaved,
}: {
  policies: PoliciesResponse | null;
  onSaved: () => Promise<void> | void;
}) {
  const cur = policies?.lockout;
  const [maxPw, setMaxPw] = useState(0);
  const [maxOtp, setMaxOtp] = useState(0);
  const { saving, error, success, run } = useSaver();

  useEffect(() => {
    if (cur) {
      setMaxPw(cur.max_password_attempts);
      setMaxOtp(cur.max_otp_attempts);
    }
  }, [cur]);

  return (
    <>
      <PanelHeader
        title="Login challenges"
        subtitle="Lock an account after repeated failed sign-in attempts. Maps to your Zitadel lockout policy."
        isDefault={cur?.is_default}
      />
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
        <SaveAlerts error={error} success={success} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FormControl sx={{ maxWidth: 260 }}>
            <FormLabel>Max failed password attempts</FormLabel>
            <Input
              type="number"
              value={maxPw}
              slotProps={{ input: { min: 0 } }}
              onChange={(e) => setMaxPw(Number(e.target.value))}
            />
            <FormHelperText>0 disables password lockout.</FormHelperText>
          </FormControl>
          <FormControl sx={{ maxWidth: 260 }}>
            <FormLabel>Max failed OTP attempts</FormLabel>
            <Input
              type="number"
              value={maxOtp}
              slotProps={{ input: { min: 0 } }}
              onChange={(e) => setMaxOtp(Number(e.target.value))}
            />
            <FormHelperText>0 disables OTP lockout.</FormHelperText>
          </FormControl>
          <Box>
            <Button
              loading={saving}
              data-testid="security-lockout-save"
              onClick={() =>
                run(async () => {
                  await putLockout({
                    max_password_attempts: maxPw,
                    max_otp_attempts: maxOtp,
                  });
                  await onSaved();
                })
              }
            >
              Save
            </Button>
          </Box>
        </Box>
      </Sheet>
    </>
  );
}

// ---- Passwordless (wired) ---------------------------------------------------

function PasswordlessPanel({
  policies,
  onSaved,
}: {
  policies: PoliciesResponse | null;
  onSaved: () => Promise<void> | void;
}) {
  const cur = policies?.login;
  const [type, setType] = useState("PASSWORDLESS_TYPE_NOT_ALLOWED");
  const [domainDiscovery, setDomainDiscovery] = useState(false);
  const { saving, error, success, run } = useSaver();

  useEffect(() => {
    if (cur) {
      setType(cur.passwordless_type || "PASSWORDLESS_TYPE_NOT_ALLOWED");
      setDomainDiscovery(cur.allow_domain_discovery);
    }
  }, [cur]);

  return (
    <>
      <PanelHeader
        title="Passwordless"
        subtitle="Let members sign in with passkeys / device biometrics instead of a password. Maps to your Zitadel login policy."
        isDefault={cur?.is_default}
      />
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
        <SaveAlerts error={error} success={success} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <FormControl sx={{ maxWidth: 280 }}>
            <FormLabel>Passwordless sign-in</FormLabel>
            <Select
              value={type}
              onChange={(_, v) => v && setType(v)}
              data-testid="security-passwordless-type"
            >
              {PASSWORDLESS_OPTIONS.map((o) => (
                <Option key={o.value} value={o.value}>
                  {o.label}
                </Option>
              ))}
            </Select>
          </FormControl>
          <ToggleRow
            label="Allow domain discovery"
            help="Route users to their org's login by email domain."
            checked={domainDiscovery}
            onChange={setDomainDiscovery}
          />
          <Box>
            <Button
              loading={saving}
              data-testid="security-passwordless-save"
              onClick={() =>
                run(async () => {
                  await putPasswordless({
                    passwordless_type: type,
                    allow_domain_discovery: domainDiscovery,
                  });
                  await onSaved();
                })
              }
            >
              Save
            </Button>
          </Box>
        </Box>
      </Sheet>
    </>
  );
}

// ---- SSO panels (read-only IdP list + link-out) -----------------------------

function SSOPanel({ mode }: { mode: "saml" | "idp" }) {
  const [data, setData] = useState<IDPsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getIDPs()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const title =
    mode === "saml"
      ? "SSO with SAML applications"
      : "SSO with third-party IdP";
  const subtitle =
    mode === "saml"
      ? "Let members sign into SAML apps using their grown identity (Zitadel as the IdP). Configure SAML apps as projects in Zitadel."
      : "Let members sign in to grown through an external identity provider (Google, Okta, OIDC/SAML) federated in Zitadel.";

  return (
    <>
      <PanelHeader title={title} subtitle={subtitle} />
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size="sm" />
          </Box>
        ) : (
          <>
            {error && (
              <Alert color="neutral" variant="soft" sx={{ mb: 1.5 }}>
                Couldn't list providers ({error}). Manage them directly in
                Zitadel.
              </Alert>
            )}
            <Typography level="title-sm" sx={{ mb: 1 }}>
              Configured identity providers
            </Typography>
            {data && data.idps.length > 0 ? (
              <List size="sm" variant="outlined" sx={{ borderRadius: "sm" }}>
                {data.idps.map((idp) => (
                  <ListItem key={idp.id}>
                    <ListItemDecorator>
                      <Icons.Hub />
                    </ListItemDecorator>
                    <Box sx={{ flex: 1 }}>
                      <Typography level="body-sm">{idp.name || idp.id}</Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {idp.type || "IdP"} · {idp.state}
                      </Typography>
                    </Box>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                No external identity providers configured for this org yet.
              </Typography>
            )}
            <Divider sx={{ my: 2 }} />
            <Chip size="sm" variant="soft" color="neutral">
              Managed in Zitadel
            </Chip>
            <Typography level="body-xs" sx={{ opacity: 0.7, mt: 1 }}>
              {mode === "saml"
                ? "Adding/editing SAML service-provider apps is done per-project in the Zitadel console."
                : "Adding/editing federated IdPs is done in the Zitadel console for your org."}
            </Typography>
          </>
        )}
      </Sheet>
    </>
  );
}

// ---- shared building blocks -------------------------------------------------

function PanelHeader({
  title,
  subtitle,
  isDefault,
}: {
  title: string;
  subtitle: string;
  isDefault?: boolean;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography level="h4">{title}</Typography>
        {isDefault && (
          <Chip size="sm" variant="soft" color="neutral">
            Using Zitadel default
          </Chip>
        )}
      </Box>
      <Typography level="body-sm" sx={{ opacity: 0.7 }}>
        {subtitle}
      </Typography>
    </Box>
  );
}

function InfoCard({
  title,
  icon,
  body,
  managed,
  comingSoon,
}: {
  title: string;
  icon: React.ReactNode;
  body: string;
  managed?: boolean;
  comingSoon?: boolean;
}) {
  return (
    <>
      <PanelHeader title={title} subtitle="" />
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
          <Box sx={{ opacity: 0.6, mt: 0.25 }}>{icon}</Box>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
              {managed && (
                <Chip size="sm" variant="soft" color="neutral">
                  Managed in Zitadel
                </Chip>
              )}
              {comingSoon && (
                <Chip size="sm" variant="soft" color="primary">
                  Coming soon
                </Chip>
              )}
            </Box>
            <Typography level="body-sm" sx={{ opacity: 0.85 }}>
              {body}
            </Typography>
          </Box>
        </Box>
      </Sheet>
    </>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  disabled,
  testid,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testid?: string;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
      <Box sx={{ flex: 1 }}>
        <Typography level="body-sm" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          {help}
        </Typography>
      </Box>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        slotProps={{ input: { "aria-label": label, ...(testid ? { "data-testid": testid } : {}) } }}
      />
    </Box>
  );
}

function SaveAlerts({
  error,
  success,
}: {
  error: string | null;
  success: boolean;
}) {
  return (
    <>
      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {success && !error && (
        <Alert color="success" variant="soft" sx={{ mb: 1.5 }}>
          Saved. Applied to your organization in Zitadel.
        </Alert>
      )}
    </>
  );
}

// useSaver centralizes the save → success/error UX shared by every wired form.
function useSaver() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await fn();
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, []);
  return { saving, error, success, run };
}
