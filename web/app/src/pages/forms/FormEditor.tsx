import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  IconButton,
  Input,
  Textarea,
  Button,
  CircularProgress,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Select,
  Option,
  Switch,
  Tabs,
  TabList,
  Tab,
  Tooltip,
  Divider,
  FormControl,
  FormLabel,
  Chip,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VisibilityIcon from "@mui/icons-material/Visibility";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import LinkIcon from "@mui/icons-material/Link";
import KeyIcon from "@mui/icons-material/Key";
import ViewStreamIcon from "@mui/icons-material/ViewStream";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getForm, updateForm } from "./api";
import type { Form, FormQuestion, FormSettings, QuestionType } from "./types";
import {
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_ORDER,
  SUBMIT_TARGET,
} from "./types";
import { blankQuestion, blankSection, FORMS_ACCENT } from "./helpers";

interface Props {
  user: User;
}

const DEFAULT_SETTINGS: FormSettings = {
  collect_email: false,
  limit_one_response: false,
  show_progress_bar: false,
  shuffle_questions: false,
  confirmation_message: "",
  is_quiz: false,
};

export default function FormEditor({ user }: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState(0); // 0 = Questions, 1 = Settings
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [activeQ, setActiveQ] = useState<string | null>(null);
  const [showAnswerKey, setShowAnswerKey] = useState<string | null>(null); // question id showing answer key

  const saveTimer = useRef<number | null>(null);
  const latest = useRef<Form | null>(null);

  useEffect(() => {
    let alive = true;
    getForm(id)
      .then((f) => {
        if (!alive) return;
        const normalized = {
          ...f,
          settings: { ...DEFAULT_SETTINGS, ...(f.settings ?? {}) },
        };
        setForm(normalized);
        latest.current = normalized;
      })
      .catch((e) => {
        if (!alive) return;
        if (
          (e as Error).message.includes("404") ||
          (e as Error).message.toLowerCase().includes("not found")
        ) {
          setNotFound(true);
        } else {
          setError((e as Error).message);
        }
      });
    return () => {
      alive = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [id]);

  const persist = useCallback(async () => {
    const f = latest.current;
    if (!f) return;
    setSaveState("saving");
    try {
      await updateForm(f.id, {
        title: f.title,
        description: f.description,
        questions: f.questions,
        settings: f.settings,
        accepting: f.accepting,
      });
      setSaveState("saved");
      window.setTimeout(
        () => setSaveState((s) => (s === "saved" ? "idle" : s)),
        1500,
      );
    } catch (e) {
      setError((e as Error).message);
      setSaveState("idle");
    }
  }, []);

  // Debounced autosave whenever the form mutates.
  const mutate = useCallback(
    (updater: (f: Form) => Form) => {
      setForm((cur) => {
        if (!cur) return cur;
        const next = updater(cur);
        latest.current = next;
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void persist(), 600);
        return next;
      });
    },
    [persist],
  );

  if (notFound) {
    return (
      <>
        <Header user={user} />
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography level="h3" sx={{ mb: 1 }}>
            Form not found
          </Typography>
          <Typography sx={{ mb: 3, opacity: 0.7 }}>
            This form may have been deleted or you don't have access.
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

  const isQuiz = form.settings?.is_quiz ?? false;

  // ---- question ops ----
  function addQuestion(afterId?: string) {
    mutate((f) => {
      const nq = blankQuestion("multiple_choice");
      const qs = [...f.questions];
      const idx = afterId
        ? qs.findIndex((q) => q.id === afterId)
        : qs.length - 1;
      qs.splice(idx + 1, 0, nq);
      setActiveQ(nq.id);
      return { ...f, questions: qs };
    });
  }
  function addSection(afterId?: string) {
    mutate((f) => {
      const ns = blankSection();
      const qs = [...f.questions];
      const idx = afterId
        ? qs.findIndex((q) => q.id === afterId)
        : qs.length - 1;
      qs.splice(idx + 1, 0, ns);
      setActiveQ(ns.id);
      return { ...f, questions: qs };
    });
  }
  function patchQuestion(qid: string, patch: Partial<FormQuestion>) {
    mutate((f) => ({
      ...f,
      questions: f.questions.map((q) =>
        q.id === qid ? { ...q, ...patch } : q,
      ),
    }));
  }
  function duplicateQuestion(qid: string) {
    mutate((f) => {
      const idx = f.questions.findIndex((q) => q.id === qid);
      if (idx < 0) return f;
      const copy = {
        ...f.questions[idx],
        id: blankQuestion().id,
        title: f.questions[idx].title,
      };
      const qs = [...f.questions];
      qs.splice(idx + 1, 0, copy);
      setActiveQ(copy.id);
      return { ...f, questions: qs };
    });
  }
  function deleteQuestion(qid: string) {
    mutate((f) => ({
      ...f,
      questions: f.questions.filter((q) => q.id !== qid),
    }));
  }
  function moveQuestion(qid: string, dir: -1 | 1) {
    mutate((f) => {
      const idx = f.questions.findIndex((q) => q.id === qid);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= f.questions.length) return f;
      const qs = [...f.questions];
      [qs[idx], qs[to]] = [qs[to], qs[idx]];
      return { ...f, questions: qs };
    });
  }
  function changeType(qid: string, type: QuestionType) {
    mutate((f) => ({
      ...f,
      questions: f.questions.map((q) => {
        if (q.id !== qid) return q;
        const needsOptions =
          type === "multiple_choice" ||
          type === "checkboxes" ||
          type === "dropdown";
        return {
          ...q,
          type,
          options: needsOptions
            ? q.options.length
              ? q.options
              : ["Option 1"]
            : [],
          scale_min: type === "linear_scale" ? q.scale_min || 1 : q.scale_min,
          scale_max: type === "linear_scale" ? q.scale_max || 5 : q.scale_max,
          // Clear branching if type no longer supports it.
          go_to_section:
            type === "multiple_choice" || type === "dropdown"
              ? q.go_to_section
              : {},
          // Clear correct answers if type no longer gradable.
          correct_answers: isGradableType(type) ? q.correct_answers : [],
        };
      }),
    }));
  }

  async function copyResponderLink() {
    const url = `${window.location.origin}/forms/d/${form!.id}/viewform`;
    try {
      await navigator.clipboard.writeText(url);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      window.prompt("Copy responder link", url);
    }
  }

  function patchSettings(patch: Partial<FormSettings>) {
    mutate((f) => ({ ...f, settings: { ...f.settings, ...patch } }));
  }

  // Collect section ids for branching selector.
  const sections = form.questions.filter((q) => q.is_section);

  return (
    <>
      <Header user={user} />

      {/* Editor action bar */}
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
          flexWrap: "wrap",
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
        <Input
          variant="plain"
          value={form.title}
          placeholder="Untitled form"
          onChange={(e) => mutate((f) => ({ ...f, title: e.target.value }))}
          sx={{
            flex: 1,
            minWidth: 80,
            maxWidth: 420,
            fontSize: "lg",
            fontWeight: 500,
            "--Input-focusedThickness": "0px",
          }}
          aria-label="Form title"
        />
        {isQuiz && (
          <Chip color="warning" size="sm" variant="soft">
            Quiz
          </Chip>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography
          level="body-xs"
          sx={{ opacity: 0.6, minWidth: 56, textAlign: "right" }}
        >
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : ""}
        </Typography>
        <Tooltip title="Copy responder link">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Copy responder link"
            onClick={copyResponderLink}
          >
            <LinkIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Preview">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Preview"
            onClick={() => navigate(`/forms/d/${form.id}/viewform`)}
          >
            <VisibilityIcon />
          </IconButton>
        </Tooltip>
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                variant: "plain",
                color: "neutral",
                "aria-label": "More",
              },
            }}
          >
            <MoreVertIcon />
          </MenuButton>
          <Menu placement="bottom-end" size="sm">
            <MenuItem onClick={() => duplicateAll()}>Make a copy</MenuItem>
            <MenuItem onClick={() => navigate(`/forms/d/${form.id}/responses`)}>
              View responses
            </MenuItem>
            <MenuItem onClick={copyResponderLink}>Get pre-filled link</MenuItem>
            <MenuItem disabled>Embed HTML</MenuItem>
            <MenuItem onClick={() => window.print()}>Print</MenuItem>
            <ListDivider />
            <MenuItem disabled>Keyboard shortcuts</MenuItem>
          </Menu>
        </Dropdown>
      </Sheet>

      {/* Tabs: Questions | Responses | Settings */}
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
            value={tab}
            onChange={(_, v) => {
              if (v === 1) {
                navigate(`/forms/d/${form.id}/responses`);
              } else {
                setTab(typeof v === "number" ? v : 0);
              }
            }}
            sx={{ bgcolor: "transparent" }}
          >
            <TabList disableUnderline sx={{ justifyContent: "center", gap: 2 }}>
              <Tab value={0} disableIndicator={false}>
                Questions
              </Tab>
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
          py: 3,
        }}
      >
        <Container maxWidth="md">
          {tab === 2 ? (
            <SettingsPanel
              accepting={form.accepting}
              settings={form.settings}
              onAccepting={(v) => mutate((f) => ({ ...f, accepting: v }))}
              onChange={patchSettings}
            />
          ) : (
            <>
              {/* Form header card */}
              <Sheet
                variant="outlined"
                sx={{
                  borderRadius: "md",
                  borderTop: `6px solid ${FORMS_ACCENT}`,
                  p: 3,
                  mb: 2,
                }}
              >
                <Input
                  variant="plain"
                  value={form.title}
                  placeholder="Untitled form"
                  onChange={(e) =>
                    mutate((f) => ({ ...f, title: e.target.value }))
                  }
                  sx={{
                    fontSize: "xl2",
                    fontWeight: 500,
                    mb: 1,
                    "--Input-focusedThickness": "0px",
                    borderBottom: "1px solid transparent",
                    "&:focus-within": { borderColor: FORMS_ACCENT },
                  }}
                  aria-label="Form title"
                />
                <Input
                  variant="plain"
                  value={form.description}
                  placeholder="Form description"
                  onChange={(e) =>
                    mutate((f) => ({ ...f, description: e.target.value }))
                  }
                  sx={{
                    "--Input-focusedThickness": "0px",
                    borderBottom: "1px solid transparent",
                    "&:focus-within": { borderColor: FORMS_ACCENT },
                  }}
                  aria-label="Form description"
                />
              </Sheet>

              {form.questions.length === 0 && (
                <Sheet
                  variant="soft"
                  sx={{ p: 4, borderRadius: "md", textAlign: "center", mb: 2 }}
                >
                  <Typography level="body-md" sx={{ opacity: 0.7 }}>
                    No questions yet. Add your first question below.
                  </Typography>
                </Sheet>
              )}

              {form.questions.map((q, i) =>
                q.is_section ? (
                  <SectionCard
                    key={q.id}
                    q={q}
                    index={i}
                    total={form.questions.length}
                    active={activeQ === q.id}
                    onActivate={() => setActiveQ(q.id)}
                    onChange={(patch) => patchQuestion(q.id, patch)}
                    onDuplicate={() => duplicateQuestion(q.id)}
                    onDelete={() => deleteQuestion(q.id)}
                    onMove={(dir) => moveQuestion(q.id, dir)}
                  />
                ) : (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    index={i}
                    total={form.questions.length}
                    active={activeQ === q.id}
                    isQuiz={isQuiz}
                    showAnswerKey={showAnswerKey === q.id}
                    sections={sections}
                    onActivate={() => setActiveQ(q.id)}
                    onChange={(patch) => patchQuestion(q.id, patch)}
                    onChangeType={(t) => changeType(q.id, t)}
                    onDuplicate={() => duplicateQuestion(q.id)}
                    onDelete={() => deleteQuestion(q.id)}
                    onMove={(dir) => moveQuestion(q.id, dir)}
                    onToggleAnswerKey={() =>
                      setShowAnswerKey((cur) => (cur === q.id ? null : q.id))
                    }
                  />
                ),
              )}

              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 1,
                  mt: 2,
                }}
              >
                <Button
                  variant="outlined"
                  color="neutral"
                  startDecorator={<AddIcon />}
                  onClick={() => addQuestion(activeQ ?? undefined)}
                  data-testid="add-question"
                >
                  Add question
                </Button>
                <Button
                  variant="outlined"
                  color="neutral"
                  startDecorator={<ViewStreamIcon />}
                  onClick={() => addSection(activeQ ?? undefined)}
                  data-testid="add-section"
                >
                  Add section
                </Button>
              </Box>
            </>
          )}
        </Container>
      </Box>
    </>
  );

  // duplicate the whole form into a new one (header "Make a copy").
  async function duplicateAll() {
    const f = latest.current;
    if (!f) return;
    const { createForm } = await import("./api");
    try {
      const copy = await createForm({
        title: `Copy of ${f.title || "Untitled form"}`,
        description: f.description,
        questions: f.questions,
      });
      navigate(`/forms/d/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
}

// ---- Section divider card ----

function SectionCard({
  q,
  index,
  total,
  active,
  onActivate,
  onChange,
  onDuplicate,
  onDelete,
  onMove,
}: {
  q: FormQuestion;
  index: number;
  total: number;
  active: boolean;
  onActivate: () => void;
  onChange: (patch: Partial<FormQuestion>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <Sheet
      variant="outlined"
      data-testid={`section-${q.id}`}
      onClick={onActivate}
      sx={{
        borderRadius: "md",
        p: { xs: 2, sm: 3 },
        mb: 2,
        borderLeft: active
          ? `6px solid ${FORMS_ACCENT}`
          : "6px solid transparent",
        borderTop: `3px solid ${FORMS_ACCENT}`,
        cursor: "pointer",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography
          level="body-xs"
          sx={{ opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}
        >
          Section
        </Typography>
        <Box sx={{ flex: 1 }}>
          <Input
            variant="plain"
            value={q.title}
            placeholder="Section title"
            onChange={(e) => onChange({ title: e.target.value })}
            sx={{
              fontSize: "lg",
              fontWeight: 600,
              "--Input-focusedThickness": "0px",
            }}
            aria-label={`Section ${index + 1} title`}
          />
        </Box>
        <Tooltip title="Move up">
          <span>
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Move down">
          <span>
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Duplicate">
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onClick={onDuplicate}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete section">
          <IconButton
            size="sm"
            variant="plain"
            color="danger"
            onClick={onDelete}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Input
        variant="plain"
        value={q.description}
        placeholder="Section description (optional)"
        onChange={(e) => onChange({ description: e.target.value })}
        sx={{ mt: 0.5, opacity: 0.7, "--Input-focusedThickness": "0px" }}
        aria-label={`Section ${index + 1} description`}
      />
    </Sheet>
  );
}

// ---- Question card ----

function isGradableType(type: QuestionType): boolean {
  return (
    type === "multiple_choice" ||
    type === "checkboxes" ||
    type === "dropdown" ||
    type === "short_answer"
  );
}

function hasBranchingType(type: QuestionType): boolean {
  return type === "multiple_choice" || type === "dropdown";
}

function QuestionCard({
  q,
  index,
  total,
  active,
  isQuiz,
  showAnswerKey,
  sections,
  onActivate,
  onChange,
  onChangeType,
  onDuplicate,
  onDelete,
  onMove,
  onToggleAnswerKey,
}: {
  q: FormQuestion;
  index: number;
  total: number;
  active: boolean;
  isQuiz: boolean;
  showAnswerKey: boolean;
  sections: FormQuestion[];
  onActivate: () => void;
  onChange: (patch: Partial<FormQuestion>) => void;
  onChangeType: (t: QuestionType) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleAnswerKey: () => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  function updateOption(idx: number, val: string) {
    const options = [...q.options];
    // If there was a go_to_section mapping for the old value, migrate the key.
    const oldVal = options[idx];
    options[idx] = val;
    if (
      q.go_to_section &&
      oldVal !== val &&
      q.go_to_section[oldVal] !== undefined
    ) {
      const newBranch = { ...q.go_to_section, [val]: q.go_to_section[oldVal] };
      delete newBranch[oldVal];
      onChange({ options, go_to_section: newBranch });
      return;
    }
    onChange({ options });
  }
  function addOption() {
    onChange({ options: [...q.options, `Option ${q.options.length + 1}`] });
  }
  function removeOption(idx: number) {
    const removed = q.options[idx];
    const options = q.options.filter((_, i) => i !== idx);
    // Remove any branching for the removed option.
    if (q.go_to_section && q.go_to_section[removed] !== undefined) {
      const newBranch = { ...q.go_to_section };
      delete newBranch[removed];
      onChange({ options, go_to_section: newBranch });
      return;
    }
    onChange({ options });
  }

  function toggleCorrectAnswer(opt: string) {
    const curr = q.correct_answers ?? [];
    if (q.type === "checkboxes") {
      // multi-select correct answers
      const next = curr.includes(opt)
        ? curr.filter((c) => c !== opt)
        : [...curr, opt];
      onChange({ correct_answers: next });
    } else {
      // single correct answer
      onChange({ correct_answers: curr.includes(opt) ? [] : [opt] });
    }
  }

  function setBranchTarget(optionValue: string, target: string) {
    onChange({ go_to_section: { ...q.go_to_section, [optionValue]: target } });
  }

  const hasOptions =
    q.type === "multiple_choice" ||
    q.type === "checkboxes" ||
    q.type === "dropdown";
  const canBranch = hasBranchingType(q.type);
  const canGrade = isGradableType(q.type);

  // Build section options for branching dropdown.
  const sectionOptions: Array<{ value: string; label: string }> = [
    { value: "", label: "(no jump)" },
    ...sections.map((s, i) => ({
      value: s.id,
      label: `Section ${i + 1}: ${s.title || "Untitled"}`,
    })),
    { value: SUBMIT_TARGET, label: "Submit form" },
  ];

  return (
    <Sheet
      variant="outlined"
      data-testid={`question-${q.id}`}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      sx={{
        borderRadius: "md",
        p: { xs: 2, sm: 3 },
        mb: 2,
        borderLeft: active
          ? `6px solid ${FORMS_ACCENT}`
          : "6px solid transparent",
        cursor: "pointer",
      }}
    >
      {/* Title row + type selector */}
      <Box
        sx={{
          display: "flex",
          gap: 2,
          alignItems: "flex-start",
          mb: 1.5,
          flexDirection: { xs: "column", sm: "row" },
        }}
      >
        <Input
          variant="soft"
          value={q.title}
          placeholder="Question"
          onChange={(e) => onChange({ title: e.target.value })}
          sx={{ flex: 1, width: "100%" }}
          aria-label={`Question ${index + 1} title`}
        />
        <Select
          value={q.type}
          onChange={(_, v) => v && onChangeType(v)}
          size="sm"
          sx={{ minWidth: { xs: "100%", sm: 180 } }}
          slotProps={{ button: { "aria-label": "Question types" } }}
        >
          {QUESTION_TYPE_ORDER.map((t) => (
            <Option key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </Option>
          ))}
        </Select>
      </Box>

      {/* Description field */}
      {q.description !== undefined && active && (
        <Input
          variant="plain"
          value={q.description}
          placeholder="Description (optional)"
          onChange={(e) => onChange({ description: e.target.value })}
          sx={{ mb: 1.5, opacity: 0.7, "--Input-focusedThickness": "0px" }}
          aria-label={`Question ${index + 1} description`}
        />
      )}

      {/* Type-specific body */}
      {q.type === "short_answer" && (
        <Input
          variant="plain"
          disabled
          placeholder="Short-answer text"
          sx={{ maxWidth: 320, opacity: 0.6 }}
        />
      )}
      {q.type === "paragraph" && (
        <Textarea
          variant="plain"
          disabled
          minRows={2}
          placeholder="Long-answer text"
          sx={{ opacity: 0.6 }}
        />
      )}
      {q.type === "date" && (
        <Input
          variant="plain"
          disabled
          type="date"
          sx={{ maxWidth: 220, opacity: 0.6 }}
        />
      )}
      {q.type === "time" && (
        <Input
          variant="plain"
          disabled
          type="time"
          sx={{ maxWidth: 180, opacity: 0.6 }}
        />
      )}
      {q.type === "file_upload" && (
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, opacity: 0.6 }}
        >
          <Button variant="outlined" size="sm" disabled>
            Add file
          </Button>
          <Typography level="body-xs">
            Respondents will upload a file
          </Typography>
        </Box>
      )}
      {q.type === "linear_scale" && (
        <Box
          sx={{
            display: "flex",
            gap: 2,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Select
            value={q.scale_min}
            onChange={(_, v) => v != null && onChange({ scale_min: v })}
            size="sm"
            aria-label="Scale minimum"
          >
            {[0, 1].map((n) => (
              <Option key={n} value={n}>
                {n}
              </Option>
            ))}
          </Select>
          <Typography>to</Typography>
          <Select
            value={q.scale_max}
            onChange={(_, v) => v != null && onChange({ scale_max: v })}
            size="sm"
            aria-label="Scale maximum"
          >
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <Option key={n} value={n}>
                {n}
              </Option>
            ))}
          </Select>
          <Input
            size="sm"
            placeholder={`Label for ${q.scale_min}`}
            value={q.scale_min_label}
            onChange={(e) => onChange({ scale_min_label: e.target.value })}
            sx={{ width: 160 }}
          />
          <Input
            size="sm"
            placeholder={`Label for ${q.scale_max}`}
            value={q.scale_max_label}
            onChange={(e) => onChange({ scale_max_label: e.target.value })}
            sx={{ width: 160 }}
          />
        </Box>
      )}
      {hasOptions && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {q.options.map((opt, idx) => (
            <Box key={idx}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {/* Quiz: mark correct answer */}
                {isQuiz && canGrade && showAnswerKey && (
                  <Tooltip title={`Mark "${opt}" as correct`}>
                    <Box
                      component="span"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCorrectAnswer(opt);
                      }}
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        border: "2px solid",
                        borderColor: (q.correct_answers ?? []).includes(opt)
                          ? "success.500"
                          : "neutral.300",
                        bgcolor: (q.correct_answers ?? []).includes(opt)
                          ? "success.100"
                          : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {(q.correct_answers ?? []).includes(opt) && (
                        <Typography
                          level="body-xs"
                          sx={{ color: "success.700", fontWeight: 700 }}
                        >
                          ✓
                        </Typography>
                      )}
                    </Box>
                  </Tooltip>
                )}
                {!isQuiz || !showAnswerKey ? (
                  <Typography level="body-sm" sx={{ width: 18, opacity: 0.6 }}>
                    {q.type === "checkboxes"
                      ? "☐"
                      : q.type === "dropdown"
                        ? `${idx + 1}.`
                        : "○"}
                  </Typography>
                ) : null}
                <Input
                  variant="plain"
                  value={opt}
                  onChange={(e) => updateOption(idx, e.target.value)}
                  sx={{ flex: 1, maxWidth: 360 }}
                  aria-label={`Option ${idx + 1}`}
                />
                {q.options.length > 1 && (
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="neutral"
                    aria-label="Remove option"
                    onClick={() => removeOption(idx)}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              {/* Branching selector per option */}
              {canBranch && active && (
                <Box sx={{ ml: 4, mt: 0.5 }}>
                  <Select
                    size="sm"
                    placeholder="Go to section…"
                    value={q.go_to_section?.[opt] ?? ""}
                    onChange={(_, v) => setBranchTarget(opt, v ?? "")}
                    sx={{ maxWidth: 280 }}
                    aria-label={`Go to section for option ${opt}`}
                  >
                    {sectionOptions.map((so) => (
                      <Option key={so.value} value={so.value}>
                        {so.label}
                      </Option>
                    ))}
                  </Select>
                </Box>
              )}
            </Box>
          ))}
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            startDecorator={<AddIcon />}
            onClick={addOption}
            sx={{ alignSelf: "flex-start" }}
          >
            Add option
          </Button>
        </Box>
      )}

      {/* Answer key / quiz panel for short_answer */}
      {isQuiz && canGrade && showAnswerKey && q.type === "short_answer" && (
        <Box
          sx={{
            mt: 1.5,
            p: 1.5,
            borderRadius: "sm",
            bgcolor: "success.50",
            border: "1px solid",
            borderColor: "success.200",
          }}
        >
          <Typography
            level="body-xs"
            sx={{ mb: 0.75, color: "success.700", fontWeight: 600 }}
          >
            Correct answers (one per line, case-insensitive)
          </Typography>
          <Textarea
            size="sm"
            minRows={2}
            value={(q.correct_answers ?? []).join("\n")}
            onChange={(e) =>
              onChange({
                correct_answers: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="e.g. Paris"
          />
        </Box>
      )}

      {/* Quiz points editor */}
      {isQuiz && canGrade && showAnswerKey && (
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography level="body-sm">Points:</Typography>
          <Input
            type="number"
            size="sm"
            value={q.points ?? 0}
            slotProps={{ input: { min: 0, max: 100 } }}
            onChange={(e) =>
              onChange({ points: Math.max(0, parseInt(e.target.value) || 0) })
            }
            sx={{ width: 80 }}
            aria-label="Question points"
          />
        </Box>
      )}

      <Divider sx={{ my: 2 }} />

      {/* Footer: reorder, duplicate, delete, required */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 0.5,
          flexWrap: "wrap",
        }}
      >
        <Tooltip title="Move up">
          <span>
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              disabled={index === 0}
              aria-label="Move question up"
              onClick={() => onMove(-1)}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Move down">
          <span>
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              disabled={index === total - 1}
              aria-label="Move question down"
              onClick={() => onMove(1)}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Duplicate">
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            aria-label="Duplicate question"
            onClick={onDuplicate}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            size="sm"
            variant="plain"
            color="danger"
            aria-label="Delete question"
            onClick={onDelete}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {isQuiz && canGrade && (
          <Tooltip title={showAnswerKey ? "Hide answer key" : "Answer key"}>
            <IconButton
              size="sm"
              variant={showAnswerKey ? "soft" : "plain"}
              color={showAnswerKey ? "success" : "neutral"}
              aria-label="Answer key"
              onClick={onToggleAnswerKey}
            >
              <KeyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Divider orientation="vertical" sx={{ mx: 1 }} />
        <Typography level="body-sm" sx={{ mr: 1 }}>
          Required
        </Typography>
        <Switch
          checked={q.required}
          onChange={(e) => onChange({ required: e.target.checked })}
          slotProps={{ input: { "aria-label": "Required" } }}
        />
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                size: "sm",
                variant: "plain",
                color: "neutral",
                "aria-label": "More options",
              },
            }}
          >
            <MoreVertIcon fontSize="small" />
          </MenuButton>
          <Menu size="sm" placement="bottom-end">
            <MenuItem onClick={onDuplicate}>Duplicate</MenuItem>
            <MenuItem color="danger" onClick={onDelete}>
              Delete
            </MenuItem>
            <ListDivider />
            <MenuItem disabled>Shuffle option order</MenuItem>
            {canBranch && (
              <MenuItem onClick={onActivate}>
                Go to section based on answer
              </MenuItem>
            )}
          </Menu>
        </Dropdown>
      </Box>

      {/* Right-click context menu (Forms parity: Duplicate / Delete) */}
      <Menu
        open={ctxMenu !== null}
        onClose={() => setCtxMenu(null)}
        size="sm"
        anchorEl={
          ctxMenu
            ? {
                getBoundingClientRect: () =>
                  ({
                    x: ctxMenu.x,
                    y: ctxMenu.y,
                    top: ctxMenu.y,
                    left: ctxMenu.x,
                    bottom: ctxMenu.y,
                    right: ctxMenu.x,
                    width: 0,
                    height: 0,
                    toJSON: () => "",
                  }) as DOMRect,
              }
            : null
        }
      >
        <MenuItem
          onClick={() => {
            onDuplicate();
            setCtxMenu(null);
          }}
        >
          Duplicate
        </MenuItem>
        <MenuItem
          color="danger"
          onClick={() => {
            onDelete();
            setCtxMenu(null);
          }}
        >
          Delete
        </MenuItem>
      </Menu>
    </Sheet>
  );
}

// ---- Settings panel ----

function SettingsPanel({
  accepting,
  settings,
  onAccepting,
  onChange,
}: {
  accepting: boolean;
  settings: FormSettings;
  onAccepting: (v: boolean) => void;
  onChange: (patch: Partial<FormSettings>) => void;
}) {
  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 3 }}>
      <Typography level="title-md" sx={{ mb: 2 }}>
        Settings
      </Typography>

      <Typography level="title-sm" sx={{ mt: 1, mb: 1, opacity: 0.8 }}>
        Responses
      </Typography>
      <ToggleRow
        label="Accepting responses"
        hint="Turn the form on or off for respondents."
        checked={accepting}
        onChange={onAccepting}
      />
      <ToggleRow
        label="Collect email addresses"
        hint="Record the responder's email with each submission."
        checked={settings.collect_email}
        onChange={(v) => onChange({ collect_email: v })}
      />
      <ToggleRow
        label="Limit to 1 response"
        hint="Respondents can submit only once."
        checked={settings.limit_one_response}
        onChange={(v) => onChange({ limit_one_response: v })}
      />

      <Divider sx={{ my: 2 }} />
      <Typography level="title-sm" sx={{ mb: 1, opacity: 0.8 }}>
        Quiz
      </Typography>
      <ToggleRow
        label="Make this a quiz"
        hint="Auto-grade responses with point values and answer keys."
        checked={settings.is_quiz}
        onChange={(v) => onChange({ is_quiz: v })}
      />

      <Divider sx={{ my: 2 }} />
      <Typography level="title-sm" sx={{ mb: 1, opacity: 0.8 }}>
        Presentation
      </Typography>
      <ToggleRow
        label="Show progress bar"
        checked={settings.show_progress_bar}
        onChange={(v) => onChange({ show_progress_bar: v })}
      />
      <ToggleRow
        label="Shuffle question order"
        checked={settings.shuffle_questions}
        onChange={(v) => onChange({ shuffle_questions: v })}
      />

      <FormControl sx={{ mt: 2 }}>
        <FormLabel>Confirmation message</FormLabel>
        <Textarea
          minRows={2}
          placeholder="Your response has been recorded."
          value={settings.confirmation_message}
          onChange={(e) => onChange({ confirmation_message: e.target.value })}
        />
      </FormControl>
    </Sheet>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", py: 1 }}>
      <Box sx={{ flex: 1 }}>
        <Typography level="body-md">{label}</Typography>
        {hint && (
          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
            {hint}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        slotProps={{ input: { "aria-label": label } }}
      />
    </Box>
  );
}
