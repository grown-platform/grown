import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Sheet,
  Stack,
  Typography,
  Alert,
  LinearProgress,
  List,
  ListItem,
} from "@mui/joy";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";

interface JobItem {
  id: string;
  kind: string;
  count: number;
  status: "pending" | "done" | "skipped" | "error";
  detail: string;
}

interface Job {
  id: string;
  source: string;
  filename: string;
  status: "pending" | "processing" | "done" | "failed";
  created_at: number;
  updated_at: number;
  items: JobItem[];
}

async function uploadArchive(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/import/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 202) {
        resolve(JSON.parse(xhr.responseText) as Job);
      } else {
        try {
          reject(
            new Error(
              JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`,
            ),
          );
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

async function fetchJobs(): Promise<Job[]> {
  const r = await fetch("/api/v1/import/jobs");
  if (!r.ok) throw new Error("fetch jobs failed");
  const d = await r.json();
  return (d.jobs ?? []) as Job[];
}

async function fetchJob(id: string): Promise<Job> {
  const r = await fetch(`/api/v1/import/jobs/${id}`);
  if (!r.ok) throw new Error("fetch job failed");
  return r.json() as Promise<Job>;
}

function kindLabel(kind: string): string {
  return (
    {
      contacts: "Contacts",
      calendar: "Calendar",
      drive: "Drive",
      photos: "Photos",
      mail: "Mail",
    }[kind] ?? kind
  );
}

function kindColor(
  kind: string,
): "primary" | "success" | "warning" | "neutral" | "danger" {
  return (
    ({
      contacts: "success",
      calendar: "primary",
      drive: "neutral",
      photos: "warning",
      mail: "danger",
    }[kind] as "primary" | "success" | "warning" | "neutral" | "danger") ??
    "neutral"
  );
}

function ItemStatusIcon({ status }: { status: JobItem["status"] }) {
  if (status === "done")
    return (
      <CheckCircleOutlineIcon sx={{ color: "success.500", fontSize: 18 }} />
    );
  if (status === "error")
    return <ErrorOutlineIcon sx={{ color: "danger.500", fontSize: 18 }} />;
  if (status === "skipped")
    return (
      <PauseCircleOutlineIcon sx={{ color: "warning.500", fontSize: 18 }} />
    );
  return <HourglassTopIcon sx={{ color: "neutral.400", fontSize: 18 }} />;
}

function JobCard({ job, onRefresh }: { job: Job; onRefresh: () => void }) {
  useEffect(() => {
    if (job.status === "pending" || job.status === "processing") {
      const t = setInterval(async () => {
        const updated = await fetchJob(job.id).catch(() => null);
        if (
          updated &&
          (updated.status === "done" || updated.status === "failed")
        ) {
          onRefresh();
          clearInterval(t);
        } else if (updated) {
          onRefresh();
        }
      }, 2000);
      return () => clearInterval(t);
    }
  }, [job.id, job.status, onRefresh]);

  const isActive = job.status === "pending" || job.status === "processing";
  const isFailed = job.status === "failed";

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2, mb: 2 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={1}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <CloudDownloadIcon sx={{ fontSize: 20, color: "primary.500" }} />
          <Typography level="title-sm" noWrap sx={{ maxWidth: 260 }}>
            {job.filename || "Archive"}
          </Typography>
        </Stack>
        <Chip
          size="sm"
          color={isFailed ? "danger" : isActive ? "warning" : "success"}
          variant="soft"
        >
          {job.status}
        </Chip>
      </Stack>
      {isActive && <LinearProgress sx={{ mb: 1 }} />}
      {job.items && job.items.length > 0 && (
        <List size="sm" sx={{ "--List-gap": "4px", p: 0 }}>
          {job.items.map((it) => (
            <ListItem key={it.id} sx={{ gap: 1, py: 0.5, px: 0 }}>
              <ItemStatusIcon status={it.status} />
              <Chip size="sm" color={kindColor(it.kind)} variant="outlined">
                {kindLabel(it.kind)}
              </Chip>
              {it.count > 0 && (
                <Typography level="body-xs" sx={{ color: "text.secondary" }}>
                  {it.count.toLocaleString()}{" "}
                  {it.kind === "drive"
                    ? "files"
                    : it.kind === "photos"
                      ? "photos"
                      : "items"}
                </Typography>
              )}
              {it.detail && (
                <Typography
                  level="body-xs"
                  sx={{ color: "text.secondary", flex: 1 }}
                  noWrap
                >
                  — {it.detail}
                </Typography>
              )}
            </ListItem>
          ))}
        </List>
      )}
      <Typography level="body-xs" sx={{ color: "text.tertiary", mt: 1 }}>
        {new Date(job.created_at * 1000).toLocaleString()}
      </Typography>
    </Sheet>
  );
}

function DropZone({
  onFile,
  disabled,
}: {
  onFile: (f: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <Sheet
      variant="outlined"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      sx={{
        borderRadius: "lg",
        p: 4,
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        borderStyle: "dashed",
        borderWidth: 2,
        borderColor: dragging ? "primary.500" : "neutral.300",
        bgcolor: dragging ? "primary.softBg" : "background.surface",
        transition: "all 0.15s",
        opacity: disabled ? 0.6 : 1,
      }}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.tgz,.tar.gz,.vcf,.ics,.mbox"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
        disabled={disabled}
      />
      <CloudUploadIcon sx={{ fontSize: 48, color: "primary.500", mb: 1 }} />
      <Typography level="title-md" mb={0.5}>
        Drop your export archive here
      </Typography>
      <Typography level="body-sm" sx={{ color: "text.secondary" }}>
        Accepts Google Takeout <code>.zip</code> / <code>.tgz</code>, Apple
        exports, and individual <code>.vcf</code>, <code>.ics</code>,{" "}
        <code>.mbox</code> files
      </Typography>
      <Button variant="soft" size="sm" sx={{ mt: 2 }} disabled={disabled}>
        Choose file
      </Button>
    </Sheet>
  );
}

function InstructionsPanel() {
  return (
    <Sheet variant="soft" sx={{ borderRadius: "md", p: 2, mb: 3 }}>
      <Typography level="title-sm" mb={1}>
        How to export your data
      </Typography>
      <Stack spacing={1}>
        <Box>
          <Typography level="body-sm" fontWeight="md">
            Google Takeout
          </Typography>
          <Typography level="body-xs" sx={{ color: "text.secondary" }}>
            Go to{" "}
            <a
              href="https://takeout.google.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              takeout.google.com
            </a>{" "}
            → select Contacts, Calendar, Drive, Gmail, and/or Photos → Download.
            Upload the resulting <code>.zip</code> or <code>.tgz</code> here.
          </Typography>
        </Box>
        <Divider />
        <Box>
          <Typography level="body-sm" fontWeight="md">
            Apple Contacts / Calendar
          </Typography>
          <Typography level="body-xs" sx={{ color: "text.secondary" }}>
            In Contacts app: File → Export → Export vCard. In Calendar app: File
            → Export → Calendar Archive (<code>.ics</code>). Upload each file
            individually.
          </Typography>
        </Box>
        <Divider />
        <Box>
          <Typography level="body-sm" fontWeight="md">
            What gets imported
          </Typography>
          <Typography level="body-xs" sx={{ color: "text.secondary" }}>
            Contacts (.vcf) → Contacts app. Calendar events (.ics) → Calendar
            app, with recurrence rules. Files (Drive/) → your Drive. Photos are
            detected and you'll be pointed to Immich. Mail (.mbox) is counted
            but not yet imported in v1.
          </Typography>
        </Box>
      </Stack>
    </Sheet>
  );
}

export default function CloudImportApp({ user }: { user: User }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const j = await fetchJobs();
      setJobs(j);
    } catch {
      // Silently ignore — could just be no DB connection in dev.
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadPct(0);
    setError(null);
    try {
      const job = await uploadArchive(file, setUploadPct);
      setJobs((prev) => [job, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }, []);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={3}>
          <CloudDownloadIcon sx={{ fontSize: 28, color: "primary.500" }} />
          <Typography level="h3">Cloud Import</Typography>
        </Stack>

        <InstructionsPanel />

        <DropZone onFile={handleFile} disabled={uploading} />

        {uploading && (
          <Box sx={{ mt: 2 }}>
            <Typography level="body-sm" mb={0.5}>
              Uploading… {uploadPct}%
            </Typography>
            <LinearProgress determinate value={uploadPct} />
          </Box>
        )}

        {error && (
          <Alert color="danger" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {jobs.length > 0 && (
          <Box mt={4}>
            <Typography level="title-md" mb={2}>
              Import history
            </Typography>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} onRefresh={loadJobs} />
            ))}
          </Box>
        )}

        {!uploading && jobs.length === 0 && (
          <Box sx={{ mt: 3, textAlign: "center" }}>
            <CircularProgress size="sm" sx={{ opacity: 0 }} />
            <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
              No imports yet. Upload an archive above to get started.
            </Typography>
          </Box>
        )}
      </Container>
    </Box>
  );
}
