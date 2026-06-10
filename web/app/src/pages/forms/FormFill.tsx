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
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getForm, submitResponse } from "./api";
import type { Form, FormQuestion, FormResponse, AnswerMap } from "./types";
import { SUBMIT_TARGET } from "./types";
import { FORMS_ACCENT } from "./helpers";

interface Props {
  user: User;
}

function isAnswered(
  q: FormQuestion,
  v: string | string[] | undefined,
): boolean {
  if (q.type === "checkboxes") return Array.isArray(v) && v.length > 0;
  if (q.type === "file_upload") return typeof v === "string" && v.trim() !== "";
  return typeof v === "string" && v.trim() !== "";
}

// Build the ordered list of section indices visible to the responder given the
// current state. Returns the ordered list of section "page" ids (undefined =
// initial page before any section). A question with is_section=true acts as a
// page boundary.
function buildPages(form: Form): string[][] {
  const pages: string[][] = [[]];
  for (const q of form.questions) {
    if (q.is_section) {
      pages.push([q.id]); // first element is the section id itself
    } else {
      pages[pages.length - 1].push(q.id);
    }
  }
  return pages;
}

// Given a current page's last MC/dropdown answer, resolve the next page index.
// Returns the index of the target page, or -1 meaning "submit now".
function resolveNextPage(
  form: Form,
  currentPageQIds: string[],
  answers: AnswerMap,
  allPages: string[][],
  currentPageIdx: number,
): number {
  // Check questions on this page for branching (last branch wins).
  let branchTarget: string | undefined;
  for (const qid of currentPageQIds) {
    const q = form.questions.find((fq) => fq.id === qid);
    if (!q || !q.go_to_section || Object.keys(q.go_to_section).length === 0)
      continue;
    const ans = answers[qid];
    if (typeof ans === "string" && q.go_to_section[ans]) {
      branchTarget = q.go_to_section[ans];
    }
  }

  if (branchTarget === SUBMIT_TARGET) return -1; // submit

  if (branchTarget) {
    // Find the page that starts with this section id.
    const idx = allPages.findIndex((page) => page[0] === branchTarget);
    if (idx >= 0) return idx;
  }

  // Default: next page.
  if (currentPageIdx + 1 >= allPages.length) return -1; // no more pages
  return currentPageIdx + 1;
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
  // Section paging.
  const [pageIdx, setPageIdx] = useState(0);
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

  const pages = useMemo(() => (form ? buildPages(form) : [[]]), [form]);
  const hasSections = pages.length > 1;

  // Questions visible on the current page (excluding the section marker itself).
  const currentPageQIds = useMemo(() => {
    if (!pages[pageIdx]) return [];
    // First element might be the section header id — skip it for actual questions.
    return pages[pageIdx].filter((qid) => {
      if (!form) return false;
      const q = form.questions.find((fq) => fq.id === qid);
      return q && !q.is_section;
    });
  }, [pages, pageIdx, form]);

  const currentPageQuestions = useMemo(() => {
    if (!form) return [];
    return currentPageQIds
      .map((qid) => form.questions.find((q) => q.id === qid))
      .filter(Boolean) as FormQuestion[];
  }, [form, currentPageQIds]);

  // Current section (if any).
  const currentSection = useMemo(() => {
    if (!form || !hasSections || pageIdx === 0) return null;
    const sectionId = pages[pageIdx]?.[0];
    return (
      form.questions.find((q) => q.id === sectionId && q.is_section) ?? null
    );
  }, [form, hasSections, pages, pageIdx]);

  const missing = useMemo(() => {
    const m = new Set<string>();
    if (!form) return m;
    currentPageQuestions.forEach((q) => {
      if (q.required && !isAnswered(q, answers[q.id])) m.add(q.id);
    });
    if (pageIdx === 0 && form.settings?.collect_email && !email.trim())
      m.add("__email__");
    return m;
  }, [form, currentPageQuestions, answers, email, pageIdx]);

  const answeredCount = useMemo(() => {
    if (!form) return 0;
    return form.questions.filter(
      (q) => !q.is_section && isAnswered(q, answers[q.id]),
    ).length;
  }, [form, answers]);

  function setAnswer(qid: string, v: string | string[]) {
    setAnswers((cur) => ({ ...cur, [qid]: v }));
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

  function goNext() {
    if (!form) return;
    if (missing.size > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const next = resolveNextPage(
      form,
      currentPageQIds,
      answers,
      pages,
      pageIdx,
    );
    if (next === -1) {
      void doSubmit();
    } else {
      setPageIdx(next);
    }
  }

  async function doSubmit() {
    if (!form) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitResponse(
        form.id,
        answers,
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
    if (missing.size > 0) {
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
                    setAnswers({});
                    setEmail("");
                    setSubmitted(false);
                    setShowErrors(false);
                    setPageIdx(0);
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

  const isLastPage = hasSections
    ? resolveNextPage(form, currentPageQIds, answers, pages, pageIdx) === -1
    : true;

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
                error={showErrors && missing.has("__email__")}
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
                {showErrors && missing.has("__email__") && (
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
                error={showErrors && missing.has(q.id)}
                onChange={(v) => setAnswer(q.id, v)}
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
                onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
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
              onClick={() => {
                setAnswers({});
                setEmail("");
                setShowErrors(false);
                setPageIdx(0);
              }}
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
  onToggle,
  onFile,
  fileRef,
}: {
  q: FormQuestion;
  value: string | string[] | undefined;
  error: boolean;
  onChange: (v: string) => void;
  onToggle: (opt: string) => void;
  onFile: (file: File | null) => void;
  fileRef: (el: HTMLInputElement | null) => void;
}) {
  const selected = Array.isArray(value) ? value : [];
  const strValue = typeof value === "string" ? value : "";

  return (
    <FormControl error={error}>
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
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
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

      {error && <FormHelperText>This is a required question</FormHelperText>}
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
