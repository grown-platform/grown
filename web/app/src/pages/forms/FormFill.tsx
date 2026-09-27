import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  Button,
  CircularProgress,
  Input,
  Textarea,
  Radio,
  RadioGroup,
  Checkbox,
  Select,
  Option,
  FormControl,
  FormLabel,
  FormHelperText,
  LinearProgress,
  Chip,
} from "@mui/joy";
import EditIcon from "@mui/icons-material/Edit";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getForm, submitResponse } from "./api";
import type {
  Form,
  FormQuestion,
  FormResponse,
  AnswerMap,
  AnswerValue,
  GridAnswer,
} from "./types";
import { FORMS_ACCENT } from "./helpers";
import {
  applyTextFormat,
  buildPages,
  formatMask,
  gridSelections,
  isAnswered,
  maskDisplay,
  nextPage,
  pruneSkipped,
  questionError,
  ratingLevels,
} from "./validate";

interface Props {
  user: User;
}

export default function FormFill({ user }: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submittedResponse, setSubmittedResponse] =
    useState<FormResponse | null>(null);
  // Section paging: the pages visited so far (Back pops, so it retraces the
  // branches the respondent actually took).
  const [history, setHistory] = useState<number[]>([0]);
  const pageIdx = history[history.length - 1];
  // Questions whose field has lost focus: their validation shows live.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // File inputs by question id.
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let alive = true;
    getForm(id)
      .then((f) => alive && setForm(f))
      .catch((e) => {
        if (!alive) return;
        if (
          (e as Error).message.toLowerCase().includes("not found") ||
          (e as Error).message.includes("404")
        ) {
          setNotFound(true);
        } else {
          setError((e as Error).message);
        }
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const pages = useMemo(
    () => buildPages(form?.questions ?? []),
    [form],
  );
  const hasSections = pages.length > 1;
  const currentPageQuestions = pages[pageIdx]?.questions ?? [];
  const currentSection = pages[pageIdx]?.section ?? null;

  // Per-question error message on the current page (required first, then
  // response validation).
  const errors = useMemo(() => {
    const m = new Map<string, string>();
    if (!form) return m;
    for (const q of currentPageQuestions) {
      const msg = questionError(q, answers[q.id]);
      if (msg) m.set(q.id, msg);
    }
    if (pageIdx === 0 && form.settings?.collect_email && !email.trim())
      m.set("__email__", "This is a required question");
    return m;
  }, [form, currentPageQuestions, answers, email, pageIdx]);

  function shownError(qid: string): string | null {
    const msg = errors.get(qid);
    if (!msg) return null;
    if (showErrors) return msg;
    // Before a Next/Submit attempt only validation (not "required") shows,
    // and only once the respondent has left the field.
    return touched.has(qid) && msg !== "This is a required question"
      ? msg
      : null;
  }

  const answeredCount = useMemo(() => {
    if (!form) return 0;
    return form.questions.filter(
      (q) => !q.is_section && isAnswered(q, answers[q.id]),
    ).length;
  }, [form, answers]);

  function setAnswer(qid: string, v: AnswerValue) {
    setAnswers((cur) => ({ ...cur, [qid]: v }));
  }
  function touch(qid: string) {
    setTouched((cur) => (cur.has(qid) ? cur : new Set(cur).add(qid)));
  }
  function toggleCheckbox(qid: string, opt: string) {
    setAnswers((cur) => {
      const arr = Array.isArray(cur[qid]) ? [...(cur[qid] as string[])] : [];
      const i = arr.indexOf(opt);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(opt);
      return { ...cur, [qid]: arr };
    });
  }

  function handleFileChange(qid: string, file: File | null) {
    if (!file) return;
    // For file_upload we encode the filename as a placeholder answer
    // (the actual upload is out of scope for the basic implementation).
    setAnswer(qid, `[file:${file.name}]`);
  }

  function resetAll() {
    setAnswers({});
    setEmail("");
    setShowErrors(false);
    setTouched(new Set());
    setHistory([0]);
  }

  function goNext() {
    if (!form) return;
    if (errors.size > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const next = nextPage(form, pages, pageIdx, answers);
    if (next === -1 || history.includes(next)) {
      void doSubmit();
    } else {
      setHistory((h) => [...h, next]);
      window.scrollTo?.(0, 0);
    }
  }

  async function doSubmit() {
    if (!form) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitResponse(
        form.id,
        // Answers left behind on sections the branches skipped aren't sent.
        pruneSkipped(form, answers),
        form.settings?.collect_email ? email : undefined,
      );
      setSubmitted(true);
      setSubmittedResponse(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    if (!form) return;
    if (errors.size > 0) {
      setShowErrors(true);
      return;
    }
    await doSubmit();
  }

  if (notFound) {
    return (
      <>
        <Header user={user} />
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography level="h3" sx={{ mb: 1 }}>
            Form not found
          </Typography>
          <Button onClick={() => navigate("/forms")}>Back to Forms</Button>
        </Container>
      </>
    );
  }

  if (form === null) {
    return (
      <>
        <Header user={user} />
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          {error ? (
            <Sheet
              color="danger"
              variant="soft"
              sx={{ p: 2, borderRadius: "md" }}
            >
              <Typography color="danger">
                Couldn't load form: {error}
              </Typography>
            </Sheet>
          ) : (
            <CircularProgress />
          )}
        </Box>
      </>
    );
  }

  if (submitted) {
    const isQuiz = form.settings?.is_quiz;
    const score = submittedResponse?.score;
    const maxScore = submittedResponse?.max_score;
    return (
      <>
        <Header user={user} />
        <Box
          sx={{
            bgcolor: "background.level1",
            minHeight: "calc(100vh - 64px)",
            py: 5,
          }}
        >
          <Container maxWidth="sm">
            <Sheet
              variant="outlined"
              sx={{
                borderRadius: "md",
                borderTop: `10px solid ${FORMS_ACCENT}`,
                p: 4,
              }}
            >
              <Typography level="h4" sx={{ mb: 1 }}>
                {form.title || "Untitled form"}
              </Typography>
              <Typography sx={{ mb: 2 }}>
                {form.settings?.confirmation_message?.trim() ||
                  "Your response has been recorded."}
              </Typography>
              {isQuiz && score !== undefined && (
                <Sheet
                  variant="soft"
                  color="success"
                  sx={{ p: 2, borderRadius: "md", mb: 2 }}
                >
                  <Typography level="title-sm" sx={{ mb: 0.5 }}>
                    Your score
                  </Typography>
                  <Typography level="h3">
                    {score} / {maxScore ?? "?"}
                  </Typography>
                  {maxScore !== undefined && maxScore > 0 && (
                    <Typography level="body-sm" sx={{ opacity: 0.8 }}>
                      {Math.round((score / maxScore) * 100)}%
                    </Typography>
                  )}
                </Sheet>
              )}
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Button
                  variant="plain"
                  onClick={() => {
                    resetAll();
                    setSubmitted(false);
                    setSubmittedResponse(null);
                  }}
                >
                  Submit another response
                </Button>
                <Button
                  variant="plain"
                  color="neutral"
                  onClick={() => navigate(`/forms/d/${form.id}`)}
                >
                  Edit this form
                </Button>
              </Box>
            </Sheet>
          </Container>
        </Box>
      </>
    );
  }

  const totalQs =
    form.questions.filter((q) => !q.is_section).length +
    (form.settings?.collect_email ? 1 : 0);
  const doneQs =
    answeredCount + (form.settings?.collect_email && email.trim() ? 1 : 0);

  const next = hasSections ? nextPage(form, pages, pageIdx, answers) : -1;
  const isLastPage = next === -1 || history.includes(next);

  return (
    <>
      <Header user={user} />
      <Box
        sx={{
          bgcolor: "background.level1",
          minHeight: "calc(100vh - 64px)",
          py: { xs: 2, sm: 4 },
        }}
      >
        <Container maxWidth="sm" sx={{ px: { xs: 1.5, sm: 3 } }}>
          {/* Preview banner */}
          <Sheet
            variant="soft"
            color="primary"
            sx={{
              borderRadius: "md",
              px: 2,
              py: 1,
              mb: 2,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography level="body-sm" sx={{ flex: 1 }}>
              {form.accepting
                ? "Preview — submitting records a real response."
                : "This form is not accepting responses."}
            </Typography>
            <Button
              size="sm"
              variant="plain"
              startDecorator={<EditIcon />}
              onClick={() => navigate(`/forms/d/${form.id}`)}
            >
              Edit
            </Button>
          </Sheet>

          {form.settings?.show_progress_bar && totalQs > 0 && (
            <LinearProgress
              determinate
              value={(doneQs / totalQs) * 100}
              sx={{ mb: 2, "--LinearProgress-progressColor": FORMS_ACCENT }}
            />
          )}

          {/* Header card (only on first page) */}
          {pageIdx === 0 && (
            <Sheet
              variant="outlined"
              sx={{
                borderRadius: "md",
                borderTop: `10px solid ${FORMS_ACCENT}`,
                p: 4,
                mb: 2,
              }}
            >
              <Typography level="h3" sx={{ mb: form.description ? 1 : 0 }}>
                {form.title || "Untitled form"}
              </Typography>
              {form.description && (
                <Typography sx={{ opacity: 0.8 }}>
                  {form.description}
                </Typography>
              )}
              {form.questions.some((q) => !q.is_section && q.required) && (
                <Typography level="body-xs" sx={{ color: "danger.500", mt: 2 }}>
                  * Indicates required question
                </Typography>
              )}
            </Sheet>
          )}

          {/* Section header (on subsequent pages) */}
          {currentSection && (
            <Sheet
              variant="outlined"
              sx={{
                borderRadius: "md",
                borderTop: `6px solid ${FORMS_ACCENT}`,
                p: 3,
                mb: 2,
              }}
            >
              <Typography level="h4">
                {currentSection.title || "Untitled section"}
              </Typography>
              {currentSection.description && (
                <Typography sx={{ opacity: 0.8, mt: 0.5 }}>
                  {currentSection.description}
                </Typography>
              )}
              {hasSections && (
                <Typography level="body-xs" sx={{ opacity: 0.5, mt: 1 }}>
                  Page {pageIdx + 1} of {pages.length}
                </Typography>
              )}
            </Sheet>
          )}

          {/* Email field (first page only) */}
          {pageIdx === 0 && form.settings?.collect_email && (
            <Sheet variant="outlined" sx={{ borderRadius: "md", p: 3, mb: 2 }}>
              <FormControl
                error={!!shownError("__email__")}
                required
              >
                <FormLabel>
                  Email{" "}
                  <Typography component="span" sx={{ color: "danger.500" }}>
                    *
                  </Typography>
                </FormLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email"
                />
                {shownError("__email__") && (
                  <FormHelperText>This is a required question</FormHelperText>
                )}
              </FormControl>
            </Sheet>
          )}

          {currentPageQuestions.map((q) => (
            <Sheet
              key={q.id}
              variant="outlined"
              sx={{ borderRadius: "md", p: 3, mb: 2 }}
            >
              <QuestionInput
                q={q}
                value={answers[q.id]}
                error={shownError(q.id)}
                onChange={(v) => setAnswer(q.id, v)}
                onBlur={() => touch(q.id)}
                onToggle={(opt) => toggleCheckbox(q.id, opt)}
                onFile={(file) => handleFileChange(q.id, file)}
                fileRef={(el) => {
                  fileRefs.current[q.id] = el;
                }}
              />
            </Sheet>
          ))}

          {error && (
            <Sheet
              color="danger"
              variant="soft"
              sx={{ p: 2, mb: 2, borderRadius: "md" }}
            >
              <Typography color="danger">{error}</Typography>
            </Sheet>
          )}

          <Box sx={{ display: "flex", alignItems: "center", mt: 1, gap: 1 }}>
            {pageIdx > 0 && (
              <Button
                variant="outlined"
                color="neutral"
                onClick={() =>
                  setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))
                }
              >
                Back
              </Button>
            )}
            {hasSections && !isLastPage ? (
              <Button
                onClick={goNext}
                loading={submitting}
                disabled={!form.accepting}
                sx={{
                  bgcolor: FORMS_ACCENT,
                  "&:hover": { bgcolor: "#6a4159" },
                }}
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={hasSections ? goNext : submit}
                loading={submitting}
                disabled={!form.accepting}
                sx={{
                  bgcolor: FORMS_ACCENT,
                  "&:hover": { bgcolor: "#6a4159" },
                }}
                data-testid="submit-response"
              >
                Submit
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              variant="plain"
              color="neutral"
              onClick={resetAll}
            >
              Clear form
            </Button>
          </Box>
        </Container>
      </Box>
    </>
  );
}

function QuestionInput({
  q,
  value,
  error,
  onChange,
  onBlur,
  onToggle,
  onFile,
  fileRef,
}: {
  q: FormQuestion;
  value: AnswerValue | undefined;
  error: string | null;
  onChange: (v: AnswerValue) => void;
  onBlur: () => void;
  onToggle: (opt: string) => void;
  onFile: (file: File | null) => void;
  fileRef: (el: HTMLInputElement | null) => void;
}) {
  const selected = Array.isArray(value) ? value : [];
  const strValue = typeof value === "string" ? value : "";
  const mask = formatMask(q.text_format, q.mask);
  const numeric =
    q.text_format === "digits" ||
    q.text_format === "phone" ||
    q.text_format === "zip" ||
    q.text_format === "credit_card";

  return (
    <FormControl
      error={!!error}
      onBlur={onBlur}
      data-testid={`fill-question-${q.id}`}
    >
      <FormLabel>
        {q.title || "Question"}
        {q.required && (
          <Typography component="span" sx={{ color: "danger.500", ml: 0.5 }}>
            *
          </Typography>
        )}
      </FormLabel>
      {q.description && (
        <Typography level="body-xs" sx={{ opacity: 0.7, mb: 1 }}>
          {q.description}
        </Typography>
      )}

      {q.type === "short_answer" && (
        <Input
          value={strValue}
          onChange={(e) =>
            onChange(applyTextFormat(q, strValue, e.target.value))
          }
          placeholder={mask ? maskDisplay(mask) : "Your answer"}
          slotProps={{
            input: {
              inputMode: numeric ? "numeric" : undefined,
              "aria-label": q.title || "Your answer",
            },
          }}
          sx={{ maxWidth: 400 }}
        />
      )}
      {q.type === "paragraph" && (
        <Textarea
          minRows={3}
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
        />
      )}
      {q.type === "date" && (
        <Input
          type="date"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          sx={{ maxWidth: 220 }}
        />
      )}
      {q.type === "time" && (
        <Input
          type="time"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          sx={{ maxWidth: 180 }}
        />
      )}
      {q.type === "file_upload" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <input
            type="file"
            ref={fileRef}
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              variant="outlined"
              size="sm"
              startDecorator={<AttachFileIcon />}
              onClick={() =>
                (
                  fileRef as unknown as { current: HTMLInputElement | null }
                )?.current?.click()
              }
            >
              Add file
            </Button>
            {strValue && (
              <Chip size="sm" variant="soft" color="success">
                {strValue.replace(/^\[file:/, "").replace(/\]$/, "")}
              </Chip>
            )}
          </Box>
          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
            Click "Add file" to select a file to upload.
          </Typography>
        </Box>
      )}
      {q.type === "multiple_choice" && (
        <RadioGroup value={strValue} onChange={(e) => onChange(e.target.value)}>
          {q.options.map((opt) => (
            <Radio key={opt} value={opt} label={opt} sx={{ my: 0.5 }} />
          ))}
        </RadioGroup>
      )}
      {q.type === "checkboxes" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {q.options.map((opt) => (
            <Checkbox
              key={opt}
              label={opt}
              checked={selected.includes(opt)}
              onChange={() => onToggle(opt)}
            />
          ))}
        </Box>
      )}
      {q.type === "dropdown" && (
        <Select
          value={strValue || null}
          onChange={(_, v) => onChange(v ?? "")}
          placeholder="Choose"
          sx={{ maxWidth: 300 }}
        >
          {q.options.map((opt) => (
            <Option key={opt} value={opt}>
              {opt}
            </Option>
          ))}
        </Select>
      )}
      {q.type === "linear_scale" && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "wrap",
            mt: 1,
          }}
        >
          {q.scale_min_label && (
            <Typography level="body-sm">{q.scale_min_label}</Typography>
          )}
          {scaleValues(q).map((n) => {
            const s = String(n);
            return (
              <Box
                key={n}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <Typography level="body-xs">{n}</Typography>
                <Radio
                  checked={strValue === s}
                  onChange={() => onChange(s)}
                  value={s}
                  slotProps={{ input: { "aria-label": `Rating ${n}` } }}
                />
              </Box>
            );
          })}
          {q.scale_max_label && (
            <Typography level="body-sm">{q.scale_max_label}</Typography>
          )}
        </Box>
      )}

      {(q.type === "multiple_choice_grid" || q.type === "checkbox_grid") && (
        <GridInput q={q} value={value} onChange={onChange} />
      )}
      {q.type === "rating" && (
        <RatingInput q={q} value={strValue} onChange={onChange} />
      )}

      {error && (
        <FormHelperText data-testid={`question-error-${q.id}`} role="alert">
          {error}
        </FormHelperText>
      )}
      {q.required && !error && (
        <Box sx={{ mt: 1 }}>
          <Chip size="sm" variant="soft" color="neutral">
            Required
          </Chip>
        </Box>
      )}
    </FormControl>
  );
}

function scaleValues(q: FormQuestion): number[] {
  const min = q.scale_min ?? 1;
  const max = q.scale_max ?? 5;
  const out: number[] = [];
  for (let n = min; n <= max; n++) out.push(n);
  return out;
}

/** Multiple-choice / checkbox grid: one row per `rows` entry, one column per
 *  option. With "limit one response per column", picking a column moves it
 *  out of any other row (as Google Forms does). */
function GridInput({
  q,
  value,
  onChange,
}: {
  q: FormQuestion;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const sel = gridSelections(value);
  const multi = q.type === "checkbox_grid";
  function pick(row: string, col: string) {
    const next: GridAnswer = {};
    for (const [r, cols] of Object.entries(sel)) {
      const kept = q.limit_one_per_column
        ? cols.filter((c) => c !== col || r === row)
        : cols;
      if (kept.length) next[r] = multi ? kept : kept[0];
    }
    const cur = sel[row] ?? [];
    if (multi) {
      const cols = cur.includes(col)
        ? cur.filter((c) => c !== col)
        : [...cur, col];
      if (cols.length) next[row] = cols;
      else delete next[row];
    } else {
      next[row] = col;
    }
    onChange(next);
  }
  return (
    <Box sx={{ overflowX: "auto", mt: 1 }}>
      <Box
        component="table"
        role={multi ? "grid" : "radiogroup"}
        aria-label={q.title || "Grid"}
        sx={{
          borderCollapse: "collapse",
          minWidth: "100%",
          "& th, & td": { px: 1, py: 0.75, textAlign: "center" },
          "& tbody tr:nth-of-type(odd)": { bgcolor: "background.level1" },
          "& th[scope=row]": { textAlign: "left", fontWeight: 400 },
        }}
      >
        <thead>
          <tr>
            <th />
            {q.options.map((c) => (
              <Typography key={c} component="th" level="body-sm">
                {c}
              </Typography>
            ))}
          </tr>
        </thead>
        <tbody>
          {(q.rows ?? []).map((row) => (
            <tr key={row}>
              <Typography component="th" scope="row" level="body-sm">
                {row}
              </Typography>
              {q.options.map((col) => {
                const on = (sel[row] ?? []).includes(col);
                const label = `${row}: ${col}`;
                return (
                  <td key={col}>
                    {multi ? (
                      <Checkbox
                        checked={on}
                        onChange={() => pick(row, col)}
                        slotProps={{ input: { "aria-label": label } }}
                      />
                    ) : (
                      <Radio
                        checked={on}
                        onChange={() => pick(row, col)}
                        name={`${q.id}-${row}`}
                        value={col}
                        slotProps={{ input: { "aria-label": label } }}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

const RATING_ICONS = {
  star: [StarIcon, StarBorderIcon],
  heart: [FavoriteIcon, FavoriteBorderIcon],
  thumb: [ThumbUpIcon, ThumbUpOffAltIcon],
} as const;

/** 1..N icon rating. Clicking the current rating clears it. */
function RatingInput({
  q,
  value,
  onChange,
}: {
  q: FormQuestion;
  value: string;
  onChange: (v: AnswerValue) => void;
}) {
  const [hover, setHover] = useState(0);
  const max = ratingLevels(q);
  const cur = Number(value) || 0;
  const [On, Off] = RATING_ICONS[q.rating_icon ?? "star"] ?? RATING_ICONS.star;
  const shown = hover || cur;
  return (
    <Box
      role="radiogroup"
      aria-label={q.title || "Rating"}
      sx={{ display: "flex", gap: 0.5, mt: 1, flexWrap: "wrap" }}
      onMouseLeave={() => setHover(0)}
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const Icon = n <= shown ? On : Off;
        return (
          <Box
            key={n}
            component="button"
            type="button"
            role="radio"
            aria-checked={cur === n}
            aria-label={`Rate ${n} of ${max}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(cur === n ? "" : String(n))}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              border: 0,
              bgcolor: "transparent",
              cursor: "pointer",
              p: 0.5,
              color: n <= shown ? FORMS_ACCENT : "neutral.400",
              borderRadius: "sm",
              "&:focus-visible": { outline: `2px solid ${FORMS_ACCENT}` },
            }}
          >
            <Icon />
            <Typography level="body-xs">{n}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}
