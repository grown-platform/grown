import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Container,
  Sheet,
  Typography,
  Input,
  Textarea,
  Button,
  FormControl,
  FormLabel,
  CircularProgress,
  Alert,
} from "@mui/joy";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { getPublicProject, submitPublicTicket, type PublicProject } from "./api";

/**
 * Public ticket intake form, reachable at /tickets/submit/:token without an
 * account. Fetches the project's public info to brand the form, posts the
 * request, then shows the returned reference (e.g. "SUP-12"). A bad or disabled
 * token renders a graceful not-found state.
 */
export default function Submit() {
  const { token = "" } = useParams();
  const [project, setProject] = useState<PublicProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    getPublicProject(token)
      .then(setProject)
      .catch((e) => setLoadError((e as Error).message))
      .finally(() => setLoaded(true));
  }, [token]);

  const canSubmit =
    name.trim() !== "" &&
    email.trim() !== "" &&
    title.trim() !== "" &&
    body.trim() !== "" &&
    !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await submitPublicTicket(token, {
        title: title.trim(),
        body: body.trim(),
        name: name.trim(),
        email: email.trim(),
      });
      setReference(r.ref);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Container sx={{ py: 6, maxWidth: 640 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <ConfirmationNumberIcon sx={{ color: "#2563EB" }} />
          <Typography level="h3">Submit a request</Typography>
        </Box>

        {!loaded ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : loadError ? (
          <Alert color="danger" variant="soft">
            This request form is not available. The link may be incorrect or has
            been disabled.
          </Alert>
        ) : reference ? (
          <Sheet
            variant="outlined"
            color="success"
            sx={{
              borderRadius: "lg",
              p: 3,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              textAlign: "center",
            }}
          >
            <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />
            <Typography level="title-lg">Request received</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.8 }}>
              Thanks{name ? `, ${name.trim()}` : ""}. Your request has been
              logged. Reference it as:
            </Typography>
            <Typography
              level="h3"
              sx={{ fontFamily: "monospace", letterSpacing: 1 }}
            >
              {reference}
            </Typography>
          </Sheet>
        ) : (
          <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3 }}>
            {project && (
              <Box sx={{ mb: 2.5 }}>
                <Typography level="title-md">{project.name}</Typography>
                {project.description && (
                  <Typography level="body-sm" sx={{ opacity: 0.75, mt: 0.5 }}>
                    {project.description}
                  </Typography>
                )}
              </Box>
            )}

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
              <FormControl size="sm">
                <FormLabel>Your name</FormLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </FormControl>
              <FormControl size="sm">
                <FormLabel>Email</FormLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                />
              </FormControl>
              <FormControl size="sm">
                <FormLabel>Subject</FormLabel>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short summary of your request"
                />
              </FormControl>
              <FormControl size="sm">
                <FormLabel>Details</FormLabel>
                <Textarea
                  minRows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe your request in detail…"
                />
              </FormControl>

              {error && (
                <Typography color="danger" level="body-sm">
                  {error}
                </Typography>
              )}

              <Button
                onClick={submit}
                disabled={!canSubmit}
                loading={busy}
                sx={{ alignSelf: "flex-start", bgcolor: "#2563EB" }}
              >
                Submit request
              </Button>
            </Box>
          </Sheet>
        )}
      </Container>
    </Box>
  );
}
