/** Editor panels for grid, rating, input-format, response-validation and
 *  after-section settings (FormEditor's question/section cards use them). */
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  Input,
  Option,
  Radio,
  Select,
  Sheet,
  Switch,
  Typography,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import type {
  FormQuestion,
  FormValidation,
  RatingIcon,
  TextFormat,
  ValidationKind,
} from "./types";
import { GRID_KEY_SEP, SUBMIT_TARGET } from "./types";
import {
  TEXT_FORMAT_LABELS,
  VALIDATION_OPS,
  formatMask,
  maskDisplay,
  ratingLevels,
} from "./validate";

type Patch = (patch: Partial<FormQuestion>) => void;

// ---------------------------------------------------------------- grid ----

function LabelList({
  label,
  items,
  onChange,
}: {
  label: "Row" | "Column";
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 200 }}>
      <Typography level="title-sm" sx={{ mb: 1 }}>
        {label}s
      </Typography>
      {items.map((it, i) => (
        <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography level="body-sm" sx={{ width: 22, opacity: 0.6 }}>
            {label === "Row" ? `${i + 1}.` : "○"}
          </Typography>
          <Input
            variant="plain"
            value={it}
            onChange={(e) =>
              onChange(items.map((x, j) => (j === i ? e.target.value : x)))
            }
            sx={{ flex: 1 }}
            slotProps={{ input: { "aria-label": `${label} ${i + 1}` } }}
          />
          {items.length > 1 && (
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      ))}
      <Button
        variant="plain"
        color="neutral"
        size="sm"
        startDecorator={<AddIcon />}
        onClick={() => onChange([...items, `${label} ${items.length + 1}`])}
      >
        Add {label.toLowerCase()}
      </Button>
    </Box>
  );
}

/** Rows and columns editor (+ per-row answer key in quiz mode). */
export function GridEditor({
  q,
  onChange,
  showAnswerKey,
}: {
  q: FormQuestion;
  onChange: Patch;
  showAnswerKey: boolean;
}) {
  const rows = q.rows ?? [];
  const multi = q.type === "checkbox_grid";
  const key = new Set(q.correct_answers ?? []);
  function toggleKey(row: string, col: string) {
    const k = row + GRID_KEY_SEP + col;
    let next = (q.correct_answers ?? []).filter((e) =>
      multi ? e !== k : !e.startsWith(row + GRID_KEY_SEP),
    );
    if (!key.has(k)) next = [...next, k];
    onChange({ correct_answers: next });
  }
  // Renaming a row or column drops answer-key entries that no longer match.
  function pruneKey(nextRows: string[], nextCols: string[]) {
    return (q.correct_answers ?? []).filter((e) => {
      const [r, c] = e.split(GRID_KEY_SEP);
      return nextRows.includes(r) && nextCols.includes(c);
    });
  }
  return (
    <Box>
      <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        <LabelList
          label="Row"
          items={rows}
          onChange={(r) =>
            onChange({ rows: r, correct_answers: pruneKey(r, q.options) })
          }
        />
        <LabelList
          label="Column"
          items={q.options}
          onChange={(c) =>
            onChange({ options: c, correct_answers: pruneKey(rows, c) })
          }
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
        <Switch
          size="sm"
          checked={!!q.limit_one_per_column}
          onChange={(e) => onChange({ limit_one_per_column: e.target.checked })}
          slotProps={{
            input: { "aria-label": "Limit to one response per column" },
          }}
        />
        <Typography level="body-sm">
          Limit to one response per column
        </Typography>
      </Box>
      {showAnswerKey && (
        <Sheet
          variant="soft"
          color="success"
          sx={{ mt: 1.5, p: 1.5, borderRadius: "sm", overflowX: "auto" }}
        >
          <Typography level="body-xs" sx={{ mb: 1, fontWeight: 600 }}>
            Correct {multi ? "answers" : "answer"} per row (points are split
            across keyed rows)
          </Typography>
          <Box
            component="table"
            sx={{ "& th, & td": { px: 1, textAlign: "center" } }}
          >
            <thead>
              <tr>
                <th />
                {q.options.map((c) => (
                  <Typography key={c} component="th" level="body-xs">
                    {c}
                  </Typography>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  <Typography component="th" level="body-xs" scope="row">
                    {r}
                  </Typography>
                  {q.options.map((c) => {
                    const on = key.has(r + GRID_KEY_SEP + c);
                    const label = `Correct: ${r} ${c}`;
                    return (
                      <td key={c}>
                        {multi ? (
                          <Checkbox
                            size="sm"
                            checked={on}
                            onChange={() => toggleKey(r, c)}
                            slotProps={{ input: { "aria-label": label } }}
                          />
                        ) : (
                          <Radio
                            size="sm"
                            checked={on}
                            onChange={() => toggleKey(r, c)}
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
        </Sheet>
      )}
    </Box>
  );
}

// -------------------------------------------------------------- rating ----

const ICON_PREVIEW: Record<RatingIcon, typeof StarBorderIcon> = {
  star: StarBorderIcon,
  heart: FavoriteBorderIcon,
  thumb: ThumbUpOffAltIcon,
};

export function RatingEditor({ q, onChange }: { q: FormQuestion; onChange: Patch }) {
  const levels = ratingLevels(q);
  const icon = q.rating_icon ?? "star";
  const Icon = ICON_PREVIEW[icon];
  return (
    <Box>
      <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
        <Select
          size="sm"
          value={levels}
          onChange={(_, v) => v != null && onChange({ scale_min: 1, scale_max: v })}
          slotProps={{ button: { "aria-label": "Rating levels" } }}
        >
          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <Option key={n} value={n}>
              {n}
            </Option>
          ))}
        </Select>
        <Select
          size="sm"
          value={icon}
          onChange={(_, v) => v && onChange({ rating_icon: v })}
          slotProps={{ button: { "aria-label": "Rating icon" } }}
        >
          <Option value="star">Star</Option>
          <Option value="heart">Heart</Option>
          <Option value="thumb">Thumbs up</Option>
        </Select>
      </Box>
      <Box sx={{ display: "flex", gap: 1, mt: 1.5, opacity: 0.6 }}>
        {Array.from({ length: levels }, (_, i) => (
          <Box key={i} sx={{ textAlign: "center" }}>
            <Icon />
            <Typography level="body-xs">{i + 1}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// -------------------------------------------------------- input format ----

export function TextFormatEditor({ q, onChange }: { q: FormQuestion; onChange: Patch }) {
  const fmt = q.text_format ?? "";
  const mask = formatMask(fmt, q.mask);
  return (
    <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap", mt: 1 }}>
      <Typography level="body-sm">Input format</Typography>
      <Select
        size="sm"
        value={fmt}
        onChange={(_, v) => onChange({ text_format: (v ?? "") as TextFormat })}
        slotProps={{ button: { "aria-label": "Input format" } }}
        sx={{ minWidth: 200 }}
      >
        {(Object.keys(TEXT_FORMAT_LABELS) as TextFormat[]).map((f) => (
          <Option key={f} value={f}>
            {TEXT_FORMAT_LABELS[f]}
          </Option>
        ))}
      </Select>
      {fmt === "mask" && (
        <Input
          size="sm"
          value={q.mask ?? ""}
          placeholder="(999) 999-9999"
          onChange={(e) => onChange({ mask: e.target.value })}
          slotProps={{ input: { "aria-label": "Custom mask" } }}
          sx={{ width: 200 }}
        />
      )}
      {fmt === "mask" && (
        <Typography level="body-xs" sx={{ opacity: 0.6, flexBasis: "100%" }}>
          9 digit · a letter · O digit or letter · X any character · \ before a
          character makes it literal
        </Typography>
      )}
      {mask && fmt !== "mask" && (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          {maskDisplay(mask)}
        </Typography>
      )}
    </Box>
  );
}

// ----------------------------------------------------- response validation ----

/** Validation kinds a question type supports. */
export function validationKinds(type: FormQuestion["type"]): ValidationKind[] {
  switch (type) {
    case "short_answer":
      return ["number", "text", "length", "regex"];
    case "paragraph":
      return ["length", "regex"];
    case "checkboxes":
      return ["checkbox"];
    default:
      return [];
  }
}

const KIND_LABELS: Record<ValidationKind, string> = {
  number: "Number",
  text: "Text",
  length: "Length",
  regex: "Regular expression",
  checkbox: "Checkbox",
};

export function defaultValidation(type: FormQuestion["type"]): FormValidation {
  const kind = validationKinds(type)[0] ?? "length";
  return { kind, op: VALIDATION_OPS[kind][0].op, value: "", value2: "", error_text: "" };
}

export function ValidationEditor({
  q,
  onChange,
}: {
  q: FormQuestion;
  onChange: Patch;
}) {
  const v = q.validation;
  if (!v || !v.kind) return null;
  const kind = v.kind as ValidationKind;
  const ops = VALIDATION_OPS[kind] ?? [];
  const op = ops.find((o) => o.op === v.op) ?? ops[0];
  const set = (patch: Partial<FormValidation>) =>
    onChange({ validation: { ...v, ...patch } });
  return (
    <Sheet
      variant="soft"
      sx={{ mt: 1.5, p: 1.5, borderRadius: "sm" }}
      data-testid={`validation-${q.id}`}
    >
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Typography level="title-sm" sx={{ mr: 1 }}>
          Response validation
        </Typography>
        <Select
          size="sm"
          value={kind}
          onChange={(_, k) =>
            k && set({ kind: k, op: VALIDATION_OPS[k][0].op, value: "", value2: "" })
          }
          slotProps={{ button: { "aria-label": "Validation type" } }}
        >
          {validationKinds(q.type).map((k) => (
            <Option key={k} value={k}>
              {KIND_LABELS[k]}
            </Option>
          ))}
        </Select>
        <Select
          size="sm"
          value={op?.op ?? ""}
          onChange={(_, o) => o && set({ op: o })}
          slotProps={{ button: { "aria-label": "Validation condition" } }}
        >
          {ops.map((o) => (
            <Option key={o.op} value={o.op}>
              {o.label}
            </Option>
          ))}
        </Select>
        {op && op.args >= 1 && (
          <Input
            size="sm"
            value={v.value ?? ""}
            placeholder={kind === "regex" ? "Pattern" : kind === "text" ? "Text" : "Number"}
            onChange={(e) => set({ value: e.target.value })}
            slotProps={{ input: { "aria-label": "Validation value" } }}
            sx={{ width: kind === "regex" || kind === "text" ? 180 : 100 }}
          />
        )}
        {op && op.args === 2 && (
          <>
            <Typography level="body-sm">and</Typography>
            <Input
              size="sm"
              value={v.value2 ?? ""}
              placeholder="Number"
              onChange={(e) => set({ value2: e.target.value })}
              slotProps={{ input: { "aria-label": "Validation upper bound" } }}
              sx={{ width: 100 }}
            />
          </>
        )}
        <Input
          size="sm"
          value={v.error_text ?? ""}
          placeholder="Custom error text"
          onChange={(e) => set({ error_text: e.target.value })}
          slotProps={{ input: { "aria-label": "Custom error text" } }}
          sx={{ flex: 1, minWidth: 160 }}
        />
        <IconButton
          size="sm"
          variant="plain"
          color="neutral"
          aria-label="Remove response validation"
          onClick={() => onChange({ validation: null })}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Sheet>
  );
}

// ------------------------------------------------------- after section ----

/** "After section N" selector shown at the end of each section. */
export function AfterSectionBar({
  number,
  value,
  sections,
  onChange,
}: {
  number: number;
  value: string;
  sections: FormQuestion[];
  onChange: (v: string) => void;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        mb: 2,
        px: 1,
        flexWrap: "wrap",
      }}
    >
      <Typography level="body-sm" sx={{ opacity: 0.8 }}>
        After section {number}
      </Typography>
      <Select
        size="sm"
        value={value}
        onChange={(_, v) => onChange(v ?? "")}
        slotProps={{ button: { "aria-label": `After section ${number}` } }}
        sx={{ minWidth: 220 }}
      >
        <Option value="">Continue to next section</Option>
        {sections.map((s, i) => (
          <Option key={s.id} value={s.id}>
            Go to section {i + 2} ({s.title || "Untitled section"})
          </Option>
        ))}
        <Option value={SUBMIT_TARGET}>Submit form</Option>
      </Select>
    </Box>
  );
}
