import { useEffect, useMemo, useState } from "react";
import {
  Container,
  Box,
  Typography,
  Sheet,
  Input,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  Chip,
  CircularProgress,
} from "@mui/joy";
import SyncAltIcon from "@mui/icons-material/SyncAlt";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PersonIcon from "@mui/icons-material/Person";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { listFiles } from "../drive/api";
import { isFolder, type DriveFile } from "../drive/types";
import { listContacts } from "../contacts/api";
import type { Contact } from "../contacts/types";

interface TransferResult {
  copied_files: number;
  copied_folders: number;
  copied_contacts: number;
  errors: number;
  target_org: string;
  messages?: string[];
}

/**
 * OrgSyncApp copies selected Drive files/folders and Contacts from the current
 * org to another org the user administers (identified by slug). Folders copy
 * recursively. The caller must be an admin of both orgs.
 */
export default function OrgSyncApp({ user }: { user: User }) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pickedFiles, setPickedFiles] = useState<Set<string>>(new Set());
  const [pickedContacts, setPickedContacts] = useState<Set<string>>(new Set());
  const [targetSlug, setTargetSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listFiles(""), listContacts()])
      .then(([f, c]) => {
        setFiles(f);
        setContacts(c);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const total = pickedFiles.size + pickedContacts.size;
  const canTransfer = total > 0 && targetSlug.trim() !== "" && !busy;

  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => (isFolder(b) ? 1 : 0) - (isFolder(a) ? 1 : 0)),
    [files],
  );

  async function transfer() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/v1/orgsync/transfer", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_slug: targetSlug.trim(),
          drive_file_ids: [...pickedFiles],
          contact_ids: [...pickedContacts],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as TransferResult;
      setResult(data);
      setPickedFiles(new Set());
      setPickedContacts(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container sx={{ py: 4, maxWidth: 900 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <SyncAltIcon sx={{ color: "#0CA678" }} />
          <Typography level="h2">Share with Friends</Typography>
        </Box>
        <Typography level="body-sm" sx={{ mb: 3, opacity: 0.75 }}>
          Copy Drive files/folders and Contacts from this organization to another
          one you administer — or share them with a friend's instance. Pick what to
          transfer, enter the target org's slug, and review before you send. Folders
          copy recursively.
        </Typography>

        {/* Roadmap teaser: reciprocal encrypted backups between friends' instances. */}
        <Sheet
          variant="soft"
          color="primary"
          sx={{ borderRadius: "lg", p: 2, mb: 3, display: "flex", gap: 1.5, alignItems: "flex-start" }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>🔐</span>
          <Box>
            <Typography level="title-sm">Coming soon: back up with friends</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.8 }}>
              Store <strong>end-to-end encrypted backups on a friend&apos;s Grown
              platform — and host theirs on yours</strong>. A mutual, zero-trust
              backup pact between self-hosted instances: your data is encrypted
              before it leaves, so your friend keeps the bytes safe but can never
              read them.
            </Typography>
          </Box>
        </Sheet>

        {/* Target + action */}
        <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 2.5, mb: 3 }}>
          <Box sx={{ display: "flex", gap: 2, alignItems: "flex-end", flexWrap: "wrap" }}>
            <FormControl size="sm" sx={{ flex: 1, minWidth: 220 }}>
              <FormLabel>Target organization (slug)</FormLabel>
              <Input
                placeholder="e.g. acme-team"
                value={targetSlug}
                onChange={(e) => setTargetSlug(e.target.value)}
              />
            </FormControl>
            <Button
              onClick={transfer}
              disabled={!canTransfer}
              loading={busy}
              startDecorator={<SyncAltIcon />}
              sx={{ bgcolor: "#0CA678" }}
            >
              Transfer {total > 0 ? `${total} item${total === 1 ? "" : "s"}` : ""}
            </Button>
          </Box>
          {error && (
            <Typography color="danger" level="body-sm" sx={{ mt: 1.5 }}>
              {error}
            </Typography>
          )}
          {result && (
            <Sheet color="success" variant="soft" sx={{ p: 1.5, mt: 1.5, borderRadius: "md" }}>
              <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                Transferred to {result.target_org}
              </Typography>
              <Typography level="body-sm">
                {result.copied_files} file(s), {result.copied_folders} folder(s),{" "}
                {result.copied_contacts} contact(s) copied
                {result.errors > 0 ? ` · ${result.errors} error(s)` : ""}.
              </Typography>
            </Sheet>
          )}
        </Sheet>

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3 }}>
            {/* Drive */}
            <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 2 }}>
              <Typography level="title-sm" sx={{ mb: 1 }}>
                Drive — root ({pickedFiles.size} selected)
              </Typography>
              {sortedFiles.length === 0 && (
                <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                  No files in the root folder.
                </Typography>
              )}
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: 380, overflow: "auto" }}>
                {sortedFiles.map((f) => (
                  <Box key={f.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Checkbox
                      size="sm"
                      checked={pickedFiles.has(f.id)}
                      onChange={() => toggle(setPickedFiles, f.id)}
                    />
                    {isFolder(f) ? (
                      <FolderIcon fontSize="small" sx={{ color: "primary.400" }} />
                    ) : (
                      <InsertDriveFileIcon fontSize="small" sx={{ opacity: 0.6 }} />
                    )}
                    <Typography level="body-sm" noWrap sx={{ flex: 1 }}>
                      {f.name}
                    </Typography>
                    {isFolder(f) && (
                      <Chip size="sm" variant="soft">
                        folder
                      </Chip>
                    )}
                  </Box>
                ))}
              </Box>
            </Sheet>

            {/* Contacts */}
            <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 2 }}>
              <Typography level="title-sm" sx={{ mb: 1 }}>
                Contacts ({pickedContacts.size} selected)
              </Typography>
              {contacts.length === 0 && (
                <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                  No contacts.
                </Typography>
              )}
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: 380, overflow: "auto" }}>
                {contacts.map((c) => (
                  <Box key={c.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Checkbox
                      size="sm"
                      checked={pickedContacts.has(c.id)}
                      onChange={() => toggle(setPickedContacts, c.id)}
                    />
                    <PersonIcon fontSize="small" sx={{ opacity: 0.6 }} />
                    <Typography level="body-sm" noWrap sx={{ flex: 1 }}>
                      {c.display_name || "(no name)"}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Sheet>
          </Box>
        )}
      </Container>
    </Box>
  );
}
