import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  Avatar,
  Button,
  Input,
  FormControl,
  FormLabel,
  FormHelperText,
  Alert,
  CircularProgress,
  Chip,
  Divider,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import type { User } from "../../api/types";
import {
  getProfile,
  patchProfile,
  type ProfileData,
  type PatchProfileInput,
} from "./profileApi";

export function ProfileSection({ user }: { user: User }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Working copies of each field, derived from the fetched profile.
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getProfile()
      .then((p) => {
        setProfile(p);
        setGivenName(p.given_name);
        setFamilyName(p.family_name);
        setUsername(p.username);
        setPhone(p.phone);
        setEmail(p.email);
      })
      .catch((e: Error) => setLoadError("Couldn't load profile: " + e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Only submit fields that actually changed.
  function buildPatch(): PatchProfileInput | null {
    if (!profile) return null;
    const patch: PatchProfileInput = {};
    if (givenName !== profile.given_name) patch.given_name = givenName;
    if (familyName !== profile.family_name) patch.family_name = familyName;
    if (username !== profile.username) patch.username = username;
    if (phone !== profile.phone) patch.phone = phone;
    if (email.toLowerCase() !== profile.email.toLowerCase())
      patch.email = email;
    return Object.keys(patch).length > 0 ? patch : null;
  }

  const dirty = !!buildPatch();

  async function save() {
    const patch = buildPatch();
    if (!patch) return;
    setSaving(true);
    setSaveError(null);
    setSavedNotice(null);
    setEmailSentTo(null);
    try {
      const result = await patchProfile(patch);
      // Refresh the profile from Zitadel so our baseline reflects the save.
      const updated = await getProfile();
      setProfile(updated);
      setGivenName(updated.given_name);
      setFamilyName(updated.family_name);
      setUsername(updated.username);
      setPhone(updated.phone);
      setEmail(updated.email);
      if (result.email_verification_sent && result.email) {
        setEmailSentTo(result.email);
      } else {
        setSavedNotice("Profile updated.");
      }
      // Notify Header (and any other listeners) that the display name may have
      // changed so the avatar menu refreshes.
      window.dispatchEvent(new CustomEvent("profile-changed"));
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.status === 409) {
        setSaveError("That username is taken.");
      } else {
        setSaveError(err.message || "Failed to save profile.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5, mb: 2 }}>
        <Typography level="title-sm" sx={{ mb: 1.5 }}>
          Profile
        </Typography>
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size="sm" />
        </Box>
      </Sheet>
    );
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Avatar sx={{ "--Avatar-size": "48px" }}>
          {(givenName || user.display_name || user.email || "?")
            .charAt(0)
            .toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography level="title-md">Profile</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Your identity in this workspace.
          </Typography>
        </Box>
      </Box>

      {loadError && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          <Icons.ErrorOutlineOutlined />
          {loadError}
        </Alert>
      )}

      {saveError && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          <Icons.ErrorOutlineOutlined />
          {saveError}
        </Alert>
      )}

      {savedNotice && !saveError && (
        <Alert color="success" variant="soft" sx={{ mb: 2 }}>
          <Icons.CheckCircleOutlineOutlined />
          {savedNotice}
        </Alert>
      )}

      {emailSentTo && (
        <Alert color="warning" variant="soft" sx={{ mb: 2 }}>
          <Icons.MailOutlineOutlined />
          We&apos;ve sent a verification link to <strong>
            {emailSentTo}
          </strong>{" "}
          — check your inbox to confirm. Your email address won&apos;t change
          until you verify it.
        </Alert>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {/* Name row */}
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <FormControl sx={{ flex: 1, minWidth: 160 }}>
            <FormLabel>First name</FormLabel>
            <Input
              value={givenName}
              onChange={(e) => {
                setGivenName(e.target.value);
                setSavedNotice(null);
                setSaveError(null);
              }}
              placeholder="First name"
            />
          </FormControl>
          <FormControl sx={{ flex: 1, minWidth: 160 }}>
            <FormLabel>Last name</FormLabel>
            <Input
              value={familyName}
              onChange={(e) => {
                setFamilyName(e.target.value);
                setSavedNotice(null);
                setSaveError(null);
              }}
              placeholder="Last name"
            />
          </FormControl>
        </Box>

        {/* Username */}
        <FormControl>
          <FormLabel>Username</FormLabel>
          <Input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setSavedNotice(null);
              setSaveError(null);
            }}
            placeholder="username"
            startDecorator={
              <Icons.AlternateEmailOutlined sx={{ opacity: 0.5 }} />
            }
          />
          <FormHelperText>Must be unique in this workspace.</FormHelperText>
        </FormControl>

        {/* Phone */}
        <FormControl>
          <FormLabel>Phone number</FormLabel>
          <Input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setSavedNotice(null);
              setSaveError(null);
            }}
            placeholder="+1 555 123 4567"
            startDecorator={<Icons.PhoneOutlined sx={{ opacity: 0.5 }} />}
            type="tel"
          />
          <FormHelperText>
            E.164 format recommended (e.g. +15551234567).
          </FormHelperText>
        </FormControl>

        {/* Email */}
        <FormControl>
          <FormLabel>Email address</FormLabel>
          <Input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSavedNotice(null);
              setSaveError(null);
            }}
            placeholder="you@example.com"
            startDecorator={<Icons.EmailOutlined sx={{ opacity: 0.5 }} />}
            type="email"
            endDecorator={
              profile ? (
                profile.email_verified ? (
                  <Chip
                    size="sm"
                    color="success"
                    variant="soft"
                    startDecorator={
                      <Icons.CheckCircleOutlineOutlined sx={{ fontSize: 14 }} />
                    }
                  >
                    Verified
                  </Chip>
                ) : (
                  <Chip size="sm" color="warning" variant="soft">
                    Unverified
                  </Chip>
                )
              ) : null
            }
          />
          <FormHelperText>
            Changing your email sends a verification link to the new address.
          </FormHelperText>
        </FormControl>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          onClick={() => void save()}
          loading={saving}
          disabled={!dirty || loading}
        >
          Save
        </Button>
      </Box>
    </Sheet>
  );
}
