import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  List,
  ListItem,
  ListItemButton,
  Modal,
  ModalClose,
  ModalDialog,
  Stack,
  Typography,
} from "@mui/joy";
import {
  FUNCTION_CATEGORIES,
  findFunction,
  searchFunctions,
  type FunctionArg,
  type FunctionInfo,
} from "./functionCatalog";
import { buildFunctionCall, parseFunctionCall } from "./functionArgs";

// Insert ▸ Function: pick a function by category or search, fill its
// arguments with per-argument help, and see the formula and its live result
// (evaluated by the caller, normally through the server engine) before
// inserting it into the active cell.

export interface FunctionWizardProps {
  open: boolean;
  onClose: () => void;
  /** The active cell's formula; a call such as "=SUM(A1,B2)" preselects SUM and fills its arguments. */
  initialFormula?: string;
  /** Computes a formula's result as display text (reject with the error text). */
  evaluate: (formula: string) => Promise<string>;
  /** Called with "=NAME(args)" when the user clicks Insert. */
  onInsert: (formula: string) => void;
}

interface Field {
  label: string;
  arg: FunctionArg;
  /** The empty extra copy of a repeating group (left out of the formula). */
  spare?: boolean;
}

// The name of a repeated argument's n-th copy: number1 → number3.
function nthName(name: string, n: number): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + n}` : `${name}${n + 1}`;
}

/** Argument values by field label (number1, number2, calculation, …). */
export type ArgValues = Record<string, string>;

/**
 * fieldsFor lays out one input per argument. A repeating group of arguments
 * gets another copy once any field of its last copy is filled; arguments
 * after the group (LAMBDA's calculation) stay last.
 */
export function fieldsFor(fn: FunctionInfo, values: ArgValues): Field[] {
  const start = fn.args.findIndex((a) => a.repeat);
  if (start < 0) return fn.args.map((arg) => ({ label: arg.name, arg }));
  let end = start;
  while (end < fn.args.length && fn.args[end].repeat) end++;
  const group = fn.args.slice(start, end);
  const out: Field[] = fn.args.slice(0, start).map((arg) => ({ label: arg.name, arg }));
  for (let copy = 0; copy < 255; copy++) {
    const labels = group.map((arg) => (copy === 0 ? arg.name : nthName(arg.name, copy)));
    const filled = labels.some((l) => (values[l] ?? "").trim() !== "");
    const spare = !filled && (copy > 0 || group.every((a) => a.optional));
    labels.forEach((label, i) => out.push(spare ? { label, arg: group[i], spare } : { label, arg: group[i] }));
    if (!filled) break;
  }
  for (const arg of fn.args.slice(end)) out.push({ label: arg.name, arg });
  return out;
}

// Spreads parsed argument texts over the fields: leading ones in order, the
// arguments after a repeating group taken from the end.
export function valuesFor(fn: FunctionInfo, args: string[]): ArgValues {
  const start = fn.args.findIndex((a) => a.repeat);
  const vals: ArgValues = {};
  if (start < 0) {
    fn.args.forEach((a, i) => (vals[a.name] = args[i] ?? ""));
    return vals;
  }
  let end = start;
  while (end < fn.args.length && fn.args[end].repeat) end++;
  const suffix = fn.args.slice(end);
  const head = args.slice(0, Math.max(start, args.length - suffix.length));
  fn.args.slice(0, start).forEach((a, i) => (vals[a.name] = head[i] ?? ""));
  const group = fn.args.slice(start, end);
  for (let i = start; i < head.length; i++) {
    const k = i - start;
    const copy = Math.floor(k / group.length);
    const arg = group[k % group.length];
    vals[copy === 0 ? arg.name : nthName(arg.name, copy)] = head[i];
  }
  suffix.forEach((a, i) => (vals[a.name] = args[head.length + i] ?? ""));
  return vals;
}

export function FunctionWizard({ open, onClose, initialFormula, evaluate, onInsert }: FunctionWizardProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<FunctionInfo | null>(null);
  const [values, setValues] = useState<ArgValues>({});
  const [focused, setFocused] = useState<number | null>(null);
  const [result, setResult] = useState("");
  const firstArgRef = useRef<HTMLInputElement | null>(null);

  // Opening: start from the active cell's call, or from an empty search.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCategory("All");
    setFocused(null);
    setResult("");
    const parsed = initialFormula ? parseFunctionCall(initialFormula) : null;
    const fn = parsed?.name ? findFunction(parsed.name) : undefined;
    if (fn && parsed) {
      setSelected(fn);
      setValues(valuesFor(fn, parsed.args));
    } else {
      setSelected(null);
      setValues({});
    }
  }, [open, initialFormula]);

  const list = useMemo(() => searchFunctions(query, category), [query, category]);
  const fields = useMemo(() => (selected ? fieldsFor(selected, values) : []), [selected, values]);
  const formula = selected ? buildFunctionCall(selected.name, fields.filter((f) => !f.spare).map((f) => values[f.label] ?? "")) : "";

  // Live result, debounced.
  useEffect(() => {
    if (!open || !formula) {
      setResult("");
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      evaluate(formula).then(
        (v) => !cancelled && setResult(v),
        (e) => !cancelled && setResult(e instanceof Error ? e.message : String(e)),
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, formula, evaluate]);

  function pick(fn: FunctionInfo, focusArgs = false) {
    if (fn.name !== selected?.name) {
      setSelected(fn);
      setValues({});
      setFocused(null);
    }
    if (focusArgs) setTimeout(() => firstArgRef.current?.focus(), 0);
  }

  function setValue(label: string, v: string) {
    setValues((cur) => ({ ...cur, [label]: v }));
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="function-wizard-title" sx={{ width: 820, maxWidth: "96vw", maxHeight: "90vh" }}>
        <ModalClose />
        <Typography id="function-wizard-title" level="title-lg">
          Insert function
        </Typography>
        <Box sx={{ display: "flex", gap: 2, minHeight: 0, flex: 1, flexDirection: { xs: "column", sm: "row" } }}>
          <Stack spacing={1} sx={{ width: { xs: "100%", sm: 280 }, minHeight: 0 }}>
            <Input
              autoFocus
              placeholder="Search functions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && list.length) {
                  e.preventDefault();
                  pick(list[0], true);
                }
              }}
              slotProps={{ input: { "aria-label": "Search functions" } }}
            />
            <Box
              component="select"
              aria-label="Function category"
              value={category}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)}
              sx={{
                font: "inherit",
                fontSize: 14,
                p: 0.75,
                borderRadius: "sm",
                border: "1px solid",
                borderColor: "neutral.outlinedBorder",
                bgcolor: "background.surface",
                color: "text.primary",
              }}
            >
              <option value="All">All</option>
              <option value="Most used">Most used</option>
              {FUNCTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Box>
            <List
              role="listbox"
              aria-label="Functions"
              size="sm"
              sx={{ overflow: "auto", height: { xs: 180, sm: 360 }, border: "1px solid", borderColor: "divider", borderRadius: "sm" }}
            >
              {list.map((fn) => (
                <ListItem key={fn.name}>
                  <ListItemButton
                    role="option"
                    aria-selected={selected?.name === fn.name}
                    selected={selected?.name === fn.name}
                    onClick={() => pick(fn)}
                    onDoubleClick={() => pick(fn, true)}
                    title={fn.description}
                  >
                    {fn.name}
                  </ListItemButton>
                </ListItem>
              ))}
              {list.length === 0 && (
                <ListItem>
                  <Typography level="body-sm">No functions match.</Typography>
                </ListItem>
              )}
            </List>
          </Stack>
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
            {!selected ? (
              <Typography level="body-sm" sx={{ color: "text.tertiary", mt: 1 }}>
                Pick a function to see its arguments.
              </Typography>
            ) : (
              <>
                <Typography level="title-md" sx={{ fontFamily: "monospace" }} data-testid="function-wizard-syntax">
                  {selected.signature}
                </Typography>
                <Typography level="body-sm">{selected.description}</Typography>
                <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
                  {selected.category}
                </Typography>
                <Stack spacing={0.75} sx={{ pt: 0.5 }}>
                  {fields.map((f, i) => (
                    <FormControl key={`${f.label}-${i}`} orientation="horizontal" sx={{ gap: 1, alignItems: "center" }}>
                      <FormLabel sx={{ width: 150, flexShrink: 0, fontFamily: "monospace", fontSize: 13 }}>
                        {f.arg.optional ? `[${f.label}]` : f.label}
                      </FormLabel>
                      <Input
                        size="sm"
                        sx={{ flex: 1 }}
                        value={values[f.label] ?? ""}
                        onChange={(e) => setValue(f.label, e.target.value)}
                        onFocus={() => setFocused(i)}
                        slotProps={{ input: { "aria-label": f.label, ref: i === 0 ? firstArgRef : undefined } }}
                      />
                    </FormControl>
                  ))}
                  {fields.length === 0 && <Typography level="body-sm">This function takes no arguments.</Typography>}
                </Stack>
                {focused !== null && fields[focused] && (
                  <Typography level="body-sm" data-testid="function-wizard-arg-help" sx={{ color: "text.secondary" }}>
                    <b>{fields[focused].label}</b>: {fields[focused].arg.help}
                  </Typography>
                )}
                <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1, mt: 1 }}>
                  <Typography level="body-sm">
                    Formula:{" "}
                    <Box component="span" sx={{ fontFamily: "monospace" }} data-testid="function-wizard-formula">
                      {formula}
                    </Box>
                  </Typography>
                  <Typography level="body-sm">
                    Result:{" "}
                    <Box component="span" sx={{ fontWeight: "lg" }} data-testid="function-wizard-result">
                      {result}
                    </Box>
                  </Typography>
                </Box>
              </>
            )}
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onInsert(formula);
              onClose();
            }}
          >
            Insert
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
