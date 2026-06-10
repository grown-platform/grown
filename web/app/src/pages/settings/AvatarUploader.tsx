import { useRef, useState } from "react";
import { Avatar, Box, Button, Typography, CircularProgress } from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { uploadAvatar, deleteAvatar } from "../../api/client";
import type { User } from "../../api/types";

interface AvatarUploaderProps {
  user: User;
  /** Called when the avatar changes so the parent can update avatar_url. */
  onAvatarChange: (newUrl: string | null) => void;
}

/**
 * AvatarUploader lets the user pick an image file and upload it as their
 * profile avatar, or remove an existing one. Mirrors the org logo upload UX.
 */
export function AvatarUploader({ user, onAvatarChange }: AvatarUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache-bust: a timestamp suffix ensures the browser re-fetches after upload/delete.
  const [cacheBuster, setCacheBuster] = useState<number | null>(null);
  // Optimistic: attempt to load the avatar; the img error drives hasAvatar.
  const [hasAvatar, setHasAvatar] = useState<boolean | null>(null); // null = unknown

  const avatarSrc = `/api/v1/me/avatar${cacheBuster != null ? `?v=${cacheBuster}` : ""}`;

  const initial = (user.display_name || user.email || "?")
    .charAt(0)
    .toUpperCase();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadAvatar(file);
      const v = Date.now();
      setCacheBuster(v);
      setHasAvatar(true);
      onAvatarChange(`/api/v1/me/avatar?v=${v}`);
    } catch (err) {
      setError((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-picked.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete() {
    setUploading(true);
    setError(null);
    try {
      await deleteAvatar();
      setHasAvatar(false);
      setCacheBuster(Date.now());
      onAvatarChange(null);
    } catch (err) {
      setError((err as Error).message ?? "Delete failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "flex-start",
      }}
    >
      <Typography level="title-sm">Profile photo</Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Box sx={{ position: "relative" }}>
          <Avatar
            src={avatarSrc}
            alt={user.display_name || user.email}
            sx={{ width: 72, height: 72, fontSize: 28 }}
            onError={() => setHasAvatar(false)}
            onLoad={() => setHasAvatar(true)}
          >
            {initial}
          </Avatar>
          {uploading && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "rgba(0,0,0,0.4)",
                borderRadius: "50%",
              }}
            >
              <CircularProgress size="sm" sx={{ color: "white" }} />
            </Box>
          )}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Button
            size="sm"
            variant="outlined"
            startDecorator={<Icons.FileUploadOutlined />}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {hasAvatar ? "Change photo" : "Upload photo"}
          </Button>
          {hasAvatar === true && (
            <Button
              size="sm"
              variant="plain"
              color="danger"
              startDecorator={<Icons.DeleteOutlineOutlined />}
              disabled={uploading}
              onClick={handleDelete}
            >
              Remove photo
            </Button>
          )}
        </Box>
      </Box>
      {error && (
        <Typography level="body-xs" color="danger">
          {error}
        </Typography>
      )}
      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
        Accepted formats: PNG, JPEG, WEBP, GIF. Max 5 MiB.
      </Typography>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </Box>
  );
}
