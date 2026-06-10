import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  Button,
  CircularProgress,
  IconButton,
  Tabs,
  TabList,
  Tab,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  LinearProgress,
  Divider,
  Chip,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getForm, getSummary, listResponses, deleteResponses } from "./api";
import type {
  Form,
  FormResponseSummary,
  FormResponse,
  AnswerMap,
} from "./types";
import { FORMS_ACCENT } from "./helpers";

interface Props {
  user: User;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function FormResponses({ user }: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<Form | null>(null);
  const [summary, setSummary] = useState<FormResponseSummary | null>(null);
  const [responses, setResponses] = useState<FormResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState(0); // 0 = Summary, 1 = Individual

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [f, s, r] = await Promise.all([
        getForm(id),
        getSummary(id),
        listResponses(id),
      ]);
      setForm(f);
      setSummary(s);
      setResponses(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onDeleteAll() {
    if (!window.confirm("Delete all responses? This cannot be undone.")) return;
    try {
      await deleteResponses(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const downloadCsv = useCallback(() => {
    if (!form || !responses) return;
    const isQuiz = form.settings?.is_quiz;
    const visibleQs = form.questions.filter((q) => !q.is_section);
    const header = [
      "Timestamp",
      ...(form.settings?.collect_email ? ["Email"] : []),
      ...visibleQs.map((q) => q.title || "Question"),
      ...(isQuiz ? ["Score", "Max Score"] : []),
    ];
    const rows = responses.map((r) => {
      let answers: AnswerMap = {};
      try {
        answers = JSON.parse(r.answers_json || "{}");
      } catch {
        /* ignore */
      }
      const cells = [fmtDate(r.created_at)];
      if (form.settings?.collect_email) cells.push(r.respondent_email || "");
      visibleQs.forEach((q) => {
        const v = answers[q.id];
        cells.push(Array.isArray(v) ? v.join("; ") : (v ?? "").toString());
      });
      if (isQuiz) {
        cells.push(r.score !== undefined ? String(r.score) : "");
        cells.push(r.max_score !== undefined ? String(r.max_score) : "");
      }
      return cells;
    });
    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(form.title || "form").replace(/\s+/g, "_")}_responses.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [form, responses]);

  const loading = form === null || summary === null || responses === null;
  const count = summary?.response_count ?? 0;

  return (
    <>
      <Header user={user} />

      {/* Action bar */}
      <Sheet
        variant="soft"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: { xs: 1, sm: 2 },
          py: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.surface",
        }}
      >
        <IconButton
          variant="plain"
          color="neutral"
          aria-label="Back to Forms"
          onClick={() => navigate("/forms")}
        >
          <ArrowBackIcon />
        </IconButton>
        <Typography level="title-md" sx={{ flex: 1 }} noWrap>
          {form?.title || "Untitled form"}
        </Typography>
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          startDecorator={<EditIcon />}
          onClick={() => navigate(`/forms/d/${id}`)}
        >
          Edit
        </Button>
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                variant: "plain",
                color: "neutral",
                "aria-label": "More options for responses",
              },
            }}
          >
            <MoreVertIcon />
          </MenuButton>
          <Menu placement="bottom-end" size="sm">
            <MenuItem disabled>Select destination for responses</MenuItem>
            <MenuItem disabled>Unlink form</MenuItem>
            <MenuItem disabled={count === 0} onClick={downloadCsv}>
              Download responses (.csv)
            </MenuItem>
            <MenuItem disabled={count === 0} onClick={() => window.print()}>
              Print all responses
            </MenuItem>
            <ListDivider />
            <MenuItem
              color="danger"
              disabled={count === 0}
              onClick={onDeleteAll}
            >
              Delete all responses
            </MenuItem>
          </Menu>
        </Dropdown>
      </Sheet>

      {/* Tabs (Questions | Responses | Settings) — keep parity with editor */}
      <Sheet
        variant="soft"
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.surface",
        }}
      >
        <Container maxWidth="md">
          <Tabs
            value={1}
            onChange={(_, v) => {
              if (v === 0 || v === 2) navigate(`/forms/d/${id}`);
            }}
            sx={{ bgcolor: "transparent" }}
          >
            <TabList disableUnderline sx={{ justifyContent: "center", gap: 2 }}>
              <Tab value={0}>Questions</Tab>
              <Tab value={1}>Responses</Tab>
              <Tab value={2}>Settings</Tab>
            </TabList>
          </Tabs>
        </Container>
      </Sheet>

      <Box
        sx={{
          bgcolor: "background.level1",
          minHeight: "calc(100vh - 200px)",
          py: { xs: 2, sm: 3 },
        }}
      >
        <Container maxWidth="md" sx={{ px: { xs: 1.5, sm: 3 } }}>
          {error && (
            <Sheet
              color="danger"
              variant="soft"
              sx={{ p: 2, mb: 2, borderRadius: "md" }}
            >
              <Typography color="danger">{error}</Typography>
            </Sheet>
          )}

          {loading && !error && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          )}

          {!loading && (
            <>
              <Box
                sx={{ display: "flex", alignItems: "baseline", mb: 2, gap: 1 }}
              >
                <Typography level="h3">{count}</Typography>
                <Typography level="body-md" sx={{ opacity: 0.7 }}>
                  response{count === 1 ? "" : "s"}
                </Typography>
              </Box>

              {count === 0 ? (
                <Sheet
                  variant="soft"
                  sx={{ p: 5, borderRadius: "md", textAlign: "center" }}
                >
                  <Typography level="body-lg" sx={{ opacity: 0.7, mb: 2 }}>
                    Waiting for responses
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={() => navigate(`/forms/d/${id}/viewform`)}
                  >
                    Open the form
                  </Button>
                </Sheet>
              ) : (
                <>
                  <Tabs
                    value={sub}
                    onChange={(_, v) => setSub(typeof v === "number" ? v : 0)}
                    sx={{ bgcolor: "transparent", mb: 2 }}
                  >
                    <TabList>
                      <Tab value={0}>Summary</Tab>
                      <Tab value={1}>Individual</Tab>
                    </TabList>
                  </Tabs>

                  {form?.settings?.is_quiz && (
                    <ScoreAggregate form={form!} responses={responses!} />
                  )}
                  {sub === 0 ? (
                    <SummaryView summary={summary!} />
                  ) : (
                    <IndividualView form={form!} responses={responses!} />
                  )}
                </>
              )}
            </>
          )}
        </Container>
      </Box>
    </>
  );
}

function SummaryView({ summary }: { summary: FormResponseSummary }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {summary.questions.map((q) => {
        const isText =
          q.type === "short_answer" ||
          q.type === "paragraph" ||
          q.type === "date" ||
          q.type === "time" ||
          q.type === "file_upload";
        const totalForQ = Object.values(q.counts ?? {}).reduce(
          (a, b) => a + b,
          0,
        );
        const entries = Object.entries(q.counts ?? {}).sort(
          (a, b) => b[1] - a[1],
        );
        return (
          <Sheet
            key={q.question_id}
            variant="outlined"
            sx={{ borderRadius: "md", p: 3 }}
          >
            <Typography level="title-md" sx={{ mb: 0.5 }}>
              {q.title || "Question"}
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.6, mb: 2 }}>
              {isText
                ? `${q.text_answers.length} response${q.text_answers.length === 1 ? "" : "s"}`
                : `${totalForQ} answer${totalForQ === 1 ? "" : "s"}`}
            </Typography>

            {isText ? (
              q.text_answers.length === 0 ? (
                <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                  No responses.
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {q.text_answers.map((a, i) => (
                    <Sheet
                      key={i}
                      variant="soft"
                      sx={{ p: 1.25, borderRadius: "sm" }}
                    >
                      <Typography level="body-sm">{a}</Typography>
                    </Sheet>
                  ))}
                </Box>
              )
            ) : entries.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No answers.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {entries.map(([label, n]) => {
                  const pct = totalForQ ? Math.round((n / totalForQ) * 100) : 0;
                  return (
                    <Box key={label}>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          mb: 0.25,
                        }}
                      >
                        <Typography level="body-sm">{label}</Typography>
                        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                          {n} ({pct}%)
                        </Typography>
                      </Box>
                      <LinearProgress
                        determinate
                        value={pct}
                        sx={{
                          "--LinearProgress-progressColor": FORMS_ACCENT,
                          "--LinearProgress-thickness": "16px",
                          borderRadius: "sm",
                        }}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Sheet>
        );
      })}
    </Box>
  );
}

function IndividualView({
  form,
  responses,
}: {
  form: Form;
  responses: FormResponse[];
}) {
  const [idx, setIdx] = useState(0);
  const current = responses[idx];
  const isQuiz = form.settings?.is_quiz;

  const answers = useMemo<AnswerMap>(() => {
    if (!current) return {};
    try {
      return JSON.parse(current.answers_json || "{}");
    } catch {
      return {};
    }
  }, [current]);

  if (!current) return null;

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 3 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 2,
          flexWrap: "wrap",
          gap: 1,
        }}
      >
        <Button
          size="sm"
          variant="outlined"
          color="neutral"
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>
        <Box sx={{ flex: 1, textAlign: "center", minWidth: 120 }}>
          <Typography level="body-sm">
            {idx + 1} of {responses.length}
            {current.respondent_email ? ` · ${current.respondent_email}` : ""}
          </Typography>
          {isQuiz && current.score !== undefined && (
            <Chip size="sm" variant="soft" color="success" sx={{ mt: 0.5 }}>
              Score: {current.score} / {current.max_score ?? "?"}
            </Chip>
          )}
        </Box>
        <Button
          size="sm"
          variant="outlined"
          color="neutral"
          disabled={idx >= responses.length - 1}
          onClick={() => setIdx((i) => Math.min(responses.length - 1, i + 1))}
        >
          Next
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {form.questions
          .filter((q) => !q.is_section)
          .map((q) => {
            const v = answers[q.id];
            const display = Array.isArray(v) ? v.join(", ") : (v ?? "");
            const isCorrect =
              isQuiz &&
              q.correct_answers?.length &&
              (q.type === "checkboxes"
                ? Array.isArray(v) &&
                  v.length === q.correct_answers.length &&
                  v.every((a) => q.correct_answers?.includes(a))
                : typeof v === "string" &&
                  q.correct_answers?.some(
                    (c) => c.toLowerCase().trim() === v.toLowerCase().trim(),
                  ));
            return (
              <Box key={q.id}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                  <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                    {q.title || "Question"}
                  </Typography>
                  {isQuiz && q.correct_answers?.length ? (
                    <Chip
                      size="sm"
                      variant="soft"
                      color={isCorrect ? "success" : "danger"}
                    >
                      {isCorrect ? "Correct" : "Incorrect"}
                    </Chip>
                  ) : null}
                  {isQuiz && q.points ? (
                    <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                      ({q.points} pts)
                    </Typography>
                  ) : null}
                </Box>
                <Typography level="body-sm" sx={{ opacity: display ? 1 : 0.5 }}>
                  {display || "(no answer)"}
                </Typography>
                {isQuiz && !isCorrect && q.correct_answers?.length ? (
                  <Typography
                    level="body-xs"
                    sx={{ color: "success.600", mt: 0.25 }}
                  >
                    Correct: {q.correct_answers.join(", ")}
                  </Typography>
                ) : null}
              </Box>
            );
          })}
      </Box>
    </Sheet>
  );
}

function ScoreAggregate({
  responses,
}: {
  form: Form;
  responses: FormResponse[];
}) {
  const gradedResponses = responses.filter((r) => r.score !== undefined);
  if (gradedResponses.length === 0) return null;

  const scores = gradedResponses.map((r) => r.score as number);
  const maxScore = gradedResponses[0]?.max_score ?? 0;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const high = Math.max(...scores);
  const low = Math.min(...scores);

  return (
    <Sheet
      variant="soft"
      color="warning"
      sx={{ borderRadius: "md", p: 2.5, mb: 2 }}
    >
      <Typography level="title-sm" sx={{ mb: 1.5 }}>
        Quiz score summary ({gradedResponses.length} graded)
      </Typography>
      <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <Box>
          <Typography level="body-xs" sx={{ opacity: 0.7 }}>
            Average
          </Typography>
          <Typography level="title-md">
            {avg.toFixed(1)} / {maxScore}
          </Typography>
        </Box>
        <Box>
          <Typography level="body-xs" sx={{ opacity: 0.7 }}>
            Highest
          </Typography>
          <Typography level="title-md">
            {high} / {maxScore}
          </Typography>
        </Box>
        <Box>
          <Typography level="body-xs" sx={{ opacity: 0.7 }}>
            Lowest
          </Typography>
          <Typography level="title-md">
            {low} / {maxScore}
          </Typography>
        </Box>
      </Box>
    </Sheet>
  );
}
