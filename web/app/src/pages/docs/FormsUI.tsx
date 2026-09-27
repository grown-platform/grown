// Content controls, forms and protection UI (Docs M10): the Forms menu,
// the control settings dialog, the list / date chooser shown at a control,
// the picture chooser, the fill-in-form bar (navigation, roles, required
// fields, export and submit) and the Protect document dialog. Mounted once
// by DocEditor (<FormsUI/>); the menu sits in MenuBar (<FormsMenu/>).
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dropdown,
  IconButton,
  Input,
  ListDivider,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Sheet,
  Stack,
  Typography,
} from "@mui/joy";
import type { Editor } from "@tiptap/react";
import {
  allSdts,
  clearContentControl,
  insertContentControl,
  isFillMode,
  goToField,
  prOf,
  removeContentControl,
  sdtAt,
  sdtState,
  selectListItem,
  setFillMode,
  setSdtDate,
  setSdtPicture,
  TYPE_LABEL,
  updateContentControl,
  type SdtHit,
  type SdtLock,
  type SdtPr,
  type SdtType,
  type ListItem,
} from "./sdt";
import { formatPreset, getAllFormsData, allFields, fieldProblem, presetFormat, type FormPreset } from "./forms";
import {
  checkPassword,
  getProtection,
  NO_PROTECTION,
  PROTECTION_LABEL,
  protectionState,
  protectWith,
  setProtection,
  type ProtectionMode,
} from "./protection";

const menuButtonSx = {
  fontWeight: 400,
  fontSize: "0.875rem",
  px: 1,
  py: 0.25,
  minHeight: 0,
  bgcolor: "transparent",
  color: "text.primary",
  "&:hover": { bgcolor: "background.level1" },
};

const EVENT = "grown-docs-forms-dialog";
type DialogKind = "settings" | "protect";

export function openFormsDialog(kind: DialogKind): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

/** Re-render on every editor transaction. */
function useTick(editor: Editor | null): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const on = () => setT((x) => x + 1);
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor]);
  return t;
}

/** The effective protection mode of an editor (re-renders on change). */
export function useProtectionMode(editor: Editor | null): ProtectionMode {
  useTick(editor);
  return editor && !editor.isDestroyed ? protectionState(editor.state).mode : "none";
}

// --- inserting ---------------------------------------------------------------------------

type FieldKind = SdtType | "email" | "phone" | "zip" | "creditCard" | "radio";

let radioSeq = 0;

/** insertField adds a form field of a kind (text presets and radio
 *  buttons included) with a fresh key. */
export function insertField(editor: Editor, kind: FieldKind): SdtHit | null {
  const n = allFields(editor.state.doc).length + 1;
  const preset: Record<string, FormPreset> = { email: "email", phone: "phone", zip: "zip", creditCard: "creditCard" };
  let type: SdtType = kind in preset ? "text" : kind === "radio" ? "checkbox" : (kind as SdtType);
  const pr: Partial<SdtPr> = { form: { key: `${kind}${n}` } };
  if (kind in preset) {
    pr.textForm = { format: presetFormat(preset[kind]) };
    pr.placeholder = { email: "name@example.com", phone: "(999) 999-9999", zip: "99999", creditCard: "9999 9999 9999 9999" }[kind as "email"];
  }
  if (kind === "radio") {
    type = "checkbox";
    const groups = allSdts(editor.state.doc).map((h) => prOf(h.node).checkbox?.groupKey).filter(Boolean);
    const group = groups[groups.length - 1] ?? "Group1";
    pr.checkbox = { checked: false, checkedSymbol: "◉", uncheckedSymbol: "○", groupKey: group, choiceName: `Choice${++radioSeq}` };
    pr.form = { key: group };
  }
  if (type === "comboBox" || type === "dropDownList") pr.items = [{ label: "Option 1", value: "1" }, { label: "Option 2", value: "2" }];
  const hit = insertContentControl(editor, type, { pr });
  editor.view.focus();
  return hit;
}

function insertCC(editor: Editor, type: SdtType, level: "inline" | "block" = "inline") {
  const pr: Partial<SdtPr> = type === "comboBox" || type === "dropDownList" ? { items: [{ label: "Option 1", value: "1" }] } : {};
  insertContentControl(editor, type, { level, pr });
  editor.view.focus();
}

// --- the menu ----------------------------------------------------------------------------

export function FormsMenu({ editor }: { editor: Editor | null }) {
  useTick(editor);
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);
  const hit = editor ? sdtAt(editor.state) : null;
  const fill = editor ? isFillMode(editor.state) : false;
  const prot = editor ? protectionState(editor.state).mode : "none";
  return (
    <Dropdown>
      <MenuButton variant="plain" size="sm" sx={menuButtonSx} data-testid="menu-forms">
        Forms
      </MenuButton>
      <Menu size="sm" placement="bottom-start" sx={{ minWidth: 260, maxHeight: "70vh", overflow: "auto" }}>
        <Typography level="body-xs" sx={{ px: 1.5, pt: 0.5, opacity: 0.7 }}>
          Content controls
        </Typography>
        {(["richText", "text", "checkbox", "comboBox", "dropDownList", "date", "picture"] as SdtType[]).map((t) => (
          <MenuItem key={t} onClick={run((e) => insertCC(e, t))} data-testid={`cc-insert-${t}`}>
            {TYPE_LABEL[t]}
          </MenuItem>
        ))}
        <MenuItem onClick={run((e) => insertCC(e, "richText", "block"))} data-testid="cc-insert-block">
          Rich text (block)
        </MenuItem>
        <ListDivider />
        <Typography level="body-xs" sx={{ px: 1.5, pt: 0.5, opacity: 0.7 }}>
          Form fields
        </Typography>
        {(
          [
            ["text", "Text field"],
            ["email", "Email"],
            ["phone", "Phone number"],
            ["zip", "ZIP code"],
            ["creditCard", "Credit card"],
            ["checkbox", "Check box"],
            ["radio", "Radio button"],
            ["comboBox", "Combo box"],
            ["dropDownList", "Drop-down list"],
            ["date", "Date"],
            ["picture", "Image"],
            ["complex", "Complex field"],
          ] as [FieldKind, string][]
        ).map(([k, label]) => (
          <MenuItem key={k} onClick={run((e) => insertField(e, k))} data-testid={`form-insert-${k}`}>
            {label}
          </MenuItem>
        ))}
        <ListDivider />
        <MenuItem disabled={!hit} onClick={() => openFormsDialog("settings")} data-testid="cc-settings">
          Control settings…
        </MenuItem>
        <MenuItem disabled={!hit} onClick={run((e) => hit && removeContentControl(e, hit.pos, true))}>
          Remove control (keep content)
        </MenuItem>
        <ListDivider />
        <MenuItem disabled={prot === "forms"} onClick={run((e) => setFillMode(e, !fill))} data-testid="forms-fill-toggle">
          {fill ? "Stop filling in" : "Fill in form"}
        </MenuItem>
        <MenuItem onClick={run((e) => downloadJson(e, "form-data"))} data-testid="forms-export">
          Export form data (JSON)
        </MenuItem>
        <MenuItem onClick={() => openFormsDialog("protect")} data-testid="forms-protect">
          {prot === "none" ? "Protect document…" : "Stop protection…"}
        </MenuItem>
      </Menu>
    </Dropdown>
  );
}

// --- export ------------------------------------------------------------------------------

export function formsJson(editor: Editor): string {
  return JSON.stringify(getAllFormsData(editor.state.doc), null, 2);
}

function downloadJson(editor: Editor, name: string): void {
  const blob = new Blob([formsJson(editor)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- settings dialog ---------------------------------------------------------------------

const LOCKS: { v: SdtLock; label: string }[] = [
  { v: "unlocked", label: "Unlocked" },
  { v: "sdtLocked", label: "Can't be deleted" },
  { v: "contentLocked", label: "Contents can't be edited" },
  { v: "sdtContentLocked", label: "Both" },
];

const PRESETS: { v: FormPreset; label: string }[] = [
  { v: "none", label: "None" },
  { v: "digits", label: "Digits" },
  { v: "letters", label: "Letters" },
  { v: "email", label: "Email" },
  { v: "phone", label: "Phone" },
  { v: "zip", label: "ZIP code" },
  { v: "creditCard", label: "Credit card" },
  { v: "mask", label: "Mask" },
  { v: "regexp", label: "Regular expression" },
];

function SettingsDialog({ editor, hit, onClose }: { editor: Editor; hit: SdtHit; onClose: () => void }) {
  const [pr, setPr] = useState<SdtPr>(() => JSON.parse(JSON.stringify(prOf(hit.node))) as SdtPr);
  const id = String(hit.node.attrs.sdtId);
  const set = (patch: Partial<SdtPr>) => setPr((p) => ({ ...p, ...patch }));
  const isForm = !!pr.form;
  const preset = formatPreset(pr.textForm?.format);
  const save = () => {
    const cur = allSdts(editor.state.doc).find((h) => String(h.node.attrs.sdtId) === id);
    if (cur) updateContentControl(editor, cur.pos, pr);
    flushSync(onClose);
    editor.view.focus();
  };
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 460, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto" }} data-testid="cc-settings-dialog">
        <ModalClose />
        <Typography level="title-md">{TYPE_LABEL[pr.type]} settings</Typography>
        <Stack spacing={1.2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1}>
            <Input size="sm" sx={{ flex: 1 }} placeholder="Title" value={pr.alias ?? ""} onChange={(e) => set({ alias: e.target.value || undefined })} slotProps={{ input: { "data-testid": "cc-title" } }} />
            <Input size="sm" sx={{ flex: 1 }} placeholder="Tag" value={pr.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })} slotProps={{ input: { "data-testid": "cc-tag" } }} />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography level="body-sm">Colour</Typography>
            <input type="color" value={pr.color ?? "#7f9cc7"} onChange={(e) => set({ color: e.target.value })} data-testid="cc-color" />
            <Select size="sm" value={pr.appearance ?? "boundingBox"} onChange={(_, v) => v && set({ appearance: v as SdtPr["appearance"] })}>
              <Option value="boundingBox">Bounding box</Option>
              <Option value="tags">Start/end tags</Option>
              <Option value="hidden">None</Option>
            </Select>
          </Stack>
          <Select size="sm" value={pr.lock ?? "unlocked"} onChange={(_, v) => v && set({ lock: v as SdtLock })} slotProps={{ button: { "data-testid": "cc-lock" } }}>
            {LOCKS.map((l) => (
              <Option key={l.v} value={l.v}>
                Lock: {l.label}
              </Option>
            ))}
          </Select>
          {pr.type !== "checkbox" && pr.type !== "picture" && (
            <Input size="sm" placeholder="Placeholder text" value={pr.placeholder ?? ""} onChange={(e) => set({ placeholder: e.target.value })} slotProps={{ input: { "data-testid": "cc-placeholder" } }} />
          )}
          <Checkbox size="sm" label="Remove the control when its contents are edited" checked={!!pr.temporary} onChange={(e) => set({ temporary: e.target.checked || undefined })} />
          {(pr.type === "comboBox" || pr.type === "dropDownList") && <ItemsEditor items={pr.items ?? []} onChange={(items) => set({ items })} />}
          {pr.type === "date" && (
            <Input size="sm" startDecorator="Format" value={pr.date?.format ?? "M/d/yyyy"} onChange={(e) => set({ date: { full: null, ...pr.date, format: e.target.value } })} />
          )}
          {pr.type === "checkbox" && (
            <Stack direction="row" spacing={1}>
              <Input size="sm" startDecorator="Checked" value={pr.checkbox?.checkedSymbol ?? ""} onChange={(e) => set({ checkbox: { ...pr.checkbox!, checkedSymbol: e.target.value || "☒" } })} />
              <Input size="sm" startDecorator="Unchecked" value={pr.checkbox?.uncheckedSymbol ?? ""} onChange={(e) => set({ checkbox: { ...pr.checkbox!, uncheckedSymbol: e.target.value || "☐" } })} />
            </Stack>
          )}
          <Checkbox size="sm" label="Form field (fillable)" checked={isForm} onChange={(e) => set({ form: e.target.checked ? { key: pr.form?.key ?? pr.tag ?? "field" } : undefined })} slotProps={{ input: { "data-testid": "cc-is-form" } as never }} />
          {isForm && (
            <Sheet variant="soft" sx={{ p: 1, borderRadius: "sm" }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1}>
                  <Input size="sm" sx={{ flex: 1 }} startDecorator="Key" value={pr.form!.key} onChange={(e) => set({ form: { ...pr.form!, key: e.target.value } })} slotProps={{ input: { "data-testid": "form-key" } }} />
                  <Input size="sm" sx={{ flex: 1 }} startDecorator="Role" value={pr.form!.role ?? ""} onChange={(e) => set({ form: { ...pr.form!, role: e.target.value || undefined } })} slotProps={{ input: { "data-testid": "form-role" } }} />
                </Stack>
                <Input size="sm" startDecorator="Tip" value={pr.form!.helpText ?? ""} onChange={(e) => set({ form: { ...pr.form!, helpText: e.target.value || undefined } })} />
                <Stack direction="row" spacing={2}>
                  <Checkbox size="sm" label="Required" checked={!!pr.form!.required} onChange={(e) => set({ form: { ...pr.form!, required: e.target.checked || undefined } })} slotProps={{ input: { "data-testid": "form-required" } as never }} />
                  <Checkbox size="sm" label="Fixed size" checked={!!pr.form!.fixed} onChange={(e) => set({ form: { ...pr.form!, fixed: e.target.checked || undefined } })} />
                </Stack>
                {pr.type === "checkbox" && (
                  <Stack direction="row" spacing={1}>
                    <Input size="sm" startDecorator="Radio group" value={pr.checkbox?.groupKey ?? ""} onChange={(e) => set({ checkbox: { ...pr.checkbox!, groupKey: e.target.value || undefined } })} />
                    <Input size="sm" startDecorator="Choice" value={pr.checkbox?.choiceName ?? ""} onChange={(e) => set({ checkbox: { ...pr.checkbox!, choiceName: e.target.value || undefined } })} />
                  </Stack>
                )}
                {pr.type === "text" && (
                  <>
                    <Stack direction="row" spacing={1}>
                      <Select size="sm" sx={{ flex: 1 }} value={preset} onChange={(_, v) => v && set({ textForm: { ...pr.textForm, format: presetFormat(v as FormPreset, pr.textForm?.format?.value ?? "") } })} slotProps={{ button: { "data-testid": "form-format" } }}>
                        {PRESETS.map((p) => (
                          <Option key={p.v} value={p.v}>
                            Format: {p.label}
                          </Option>
                        ))}
                      </Select>
                      <Input size="sm" type="number" sx={{ width: 120 }} startDecorator="Max" value={pr.textForm?.maxChars ?? ""} onChange={(e) => set({ textForm: { ...pr.textForm, maxChars: e.target.value ? Math.max(0, +e.target.value) : undefined } })} />
                    </Stack>
                    {(preset === "mask" || preset === "regexp") && (
                      <Input size="sm" startDecorator={preset === "mask" ? "Mask" : "RegExp"} value={pr.textForm?.format?.value ?? ""} onChange={(e) => set({ textForm: { ...pr.textForm, format: { type: preset === "mask" ? "mask" : "regexp", value: e.target.value } } })} />
                    )}
                    <Stack direction="row" spacing={2}>
                      <Checkbox size="sm" label="Comb of characters" checked={!!pr.textForm?.comb} onChange={(e) => set({ textForm: { ...pr.textForm, comb: e.target.checked || undefined } })} />
                      <Checkbox size="sm" label="Multiline" checked={!!pr.textForm?.multiLine} onChange={(e) => set({ textForm: { ...pr.textForm, multiLine: e.target.checked || undefined } })} />
                    </Stack>
                  </>
                )}
              </Stack>
            </Sheet>
          )}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="sm" variant="plain" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} data-testid="cc-settings-ok">
              OK
            </Button>
          </Stack>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

function ItemsEditor({ items, onChange }: { items: ListItem[]; onChange: (i: ListItem[]) => void }) {
  return (
    <Stack spacing={0.5}>
      <Typography level="body-sm">Items</Typography>
      {items.map((it, i) => (
        <Stack key={i} direction="row" spacing={0.5}>
          <Input size="sm" sx={{ flex: 1 }} placeholder="Display text" value={it.label} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input size="sm" sx={{ flex: 1 }} placeholder="Value" value={it.value} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <IconButton size="sm" variant="plain" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ✕
          </IconButton>
        </Stack>
      ))}
      <Button size="sm" variant="outlined" onClick={() => onChange([...items, { label: `Option ${items.length + 1}`, value: String(items.length + 1) }])} data-testid="cc-add-item">
        Add item
      </Button>
    </Stack>
  );
}

// --- protect dialog ----------------------------------------------------------------------

function ProtectDialog({ editor, docId, onClose }: { editor: Editor; docId?: string; onClose: () => void }) {
  const current = getProtection(editor);
  const protectedNow = current.mode !== "none" && current.enforced;
  const [mode, setMode] = useState<ProtectionMode>("readOnly");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setErr("");
    if (protectedNow) {
      if (current.hash && !checkPassword(current, pw)) {
        if (current.algorithm !== "word-legacy" || !window.confirm("This password was set in Word with a scheme Grown can't check. Remove the protection anyway?")) {
          setErr("Wrong password.");
          return;
        }
      }
      setProtection(editor, NO_PROTECTION);
      await syncServer(docId, "none");
      onClose();
      return;
    }
    if (pw !== pw2) {
      setErr("The passwords don't match.");
      return;
    }
    setBusy(true);
    // Hashing (100,000 rounds) takes a moment; let the dialog paint first.
    await new Promise((r) => setTimeout(r, 20));
    setProtection(editor, protectWith(mode, pw));
    await syncServer(docId, mode);
    setBusy(false);
    onClose();
  };
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 420, maxWidth: "95vw" }} data-testid="protect-dialog">
        <ModalClose />
        <Typography level="title-md">{protectedNow ? "Stop protection" : "Protect document"}</Typography>
        {protectedNow ? (
          <Typography level="body-sm">
            Protected: {PROTECTION_LABEL[current.mode]}.{current.hash ? " Enter the password to stop protection." : ""}
          </Typography>
        ) : (
          <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as ProtectionMode)} sx={{ gap: 0.5 }}>
            {(["readOnly", "comments", "trackedChanges", "forms"] as ProtectionMode[]).map((m) => (
              <Radio key={m} value={m} label={PROTECTION_LABEL[m]} size="sm" slotProps={{ input: { "data-testid": `protect-${m}` } as never }} />
            ))}
          </RadioGroup>
        )}
        {(!protectedNow || current.hash) && (
          <Input size="sm" type="password" placeholder={protectedNow ? "Password" : "Password (optional)"} value={pw} onChange={(e) => setPw(e.target.value)} slotProps={{ input: { "data-testid": "protect-password" } }} />
        )}
        {!protectedNow && pw && <Input size="sm" type="password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} slotProps={{ input: { "data-testid": "protect-password2" } }} />}
        {err && (
          <Typography level="body-sm" color="danger">
            {err}
          </Typography>
        )}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="sm" variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} onClick={() => void apply()} data-testid="protect-ok">
            {protectedNow ? "Stop protection" : "Protect"}
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

/** Tell the server (it rejects non-owners' writes to read-only documents). */
async function syncServer(docId: string | undefined, mode: ProtectionMode): Promise<void> {
  if (!docId) return;
  try {
    await fetch(`/api/v1/docs/d/${encodeURIComponent(docId)}/protection`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode === "none" ? "" : mode }),
    });
  } catch {
    /* the editors still enforce it */
  }
}

// --- choosers at a control ---------------------------------------------------------------

function Chooser({ editor }: { editor: Editor }) {
  useTick(editor);
  const hit = sdtAt(editor.state);
  const [closed, setClosed] = useState<string | null>(null);
  const [, setScroll] = useState(0);
  useEffect(() => {
    const on = () => setScroll((x) => x + 1);
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, []);
  const pr = hit ? prOf(hit.node) : null;
  const key = hit ? `${hit.node.attrs.sdtId}` : null;
  useEffect(() => setClosed(null), [key]);
  if (!hit || !pr || !editor.isEditable || closed === key) return null;
  if (pr.type !== "comboBox" && pr.type !== "dropDownList" && pr.type !== "date") return null;
  if (pr.lock === "contentLocked" || pr.lock === "sdtContentLocked") return null;
  const st = editor.state;
  if (isFillMode(st) && (!pr.form || (sdtState(st).role && pr.form.role && pr.form.role !== sdtState(st).role))) return null;
  let place: { left: number; top?: number; bottom?: number };
  try {
    const c = editor.view.coordsAtPos(hit.pos + hit.node.nodeSize - 1);
    // Below the control, or above it when it wouldn't fit.
    const h = pr.type === "date" ? 90 : Math.max(1, pr.items?.length ?? 0) * 34 + 12;
    place = c.bottom + 4 + h > window.innerHeight ? { left: c.left, bottom: window.innerHeight - c.top + 4 } : { left: c.left, top: c.bottom + 4 };
  } catch {
    return null;
  }
  const pos = hit.pos;
  const done = () => {
    setClosed(key);
    editor.view.focus();
  };
  return (
    <Sheet
      variant="outlined"
      data-testid="sdt-chooser"
      onMouseDown={(e) => e.preventDefault()}
      sx={{ position: "fixed", ...place, zIndex: 1300, p: 0.5, borderRadius: "sm", boxShadow: "md", minWidth: 160 }}
    >
      {pr.type === "date" ? (
        <Stack spacing={0.5} sx={{ p: 0.5 }}>
          <input
            type="date"
            data-testid="sdt-date-input"
            value={pr.date?.full ?? ""}
            onChange={(e) => {
              setSdtDate(editor, pos, e.target.value || null);
            }}
          />
          <Stack direction="row" spacing={0.5}>
            <Button size="sm" variant="plain" onClick={() => (setSdtDate(editor, pos, todayIso()), done())}>
              Today
            </Button>
            <Button size="sm" variant="plain" onClick={() => (clearContentControl(editor, pos), done())}>
              Clear
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack>
          {(pr.items ?? []).map((it) => (
            <Button key={it.value} size="sm" variant="plain" color="neutral" sx={{ justifyContent: "flex-start" }} data-testid="sdt-item" onClick={() => (selectListItem(editor, pos, it.value), done())}>
              {it.label || it.value}
            </Button>
          ))}
          {!pr.items?.length && (
            <Typography level="body-xs" sx={{ p: 1 }}>
              No items (Control settings)
            </Typography>
          )}
        </Stack>
      )}
    </Sheet>
  );
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function PictureChooser({ editor }: { editor: Editor }) {
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      target.current = (e as CustomEvent<{ pos: number }>).detail.pos;
      input.current?.click();
    };
    window.addEventListener("grown-docs-sdt-picture", on);
    return () => window.removeEventListener("grown-docs-sdt-picture", on);
  }, []);
  return (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      data-testid="sdt-picture-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        const pos = target.current;
        if (!f || pos == null) return;
        const reader = new FileReader();
        reader.onload = () => setSdtPicture(editor, pos, String(reader.result), { width: 160 });
        reader.readAsDataURL(f);
      }}
    />
  );
}

// --- fill-in bar -------------------------------------------------------------------------

function FillBar({ editor, title }: { editor: Editor; title?: string }) {
  useTick(editor);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const st = editor.state;
  const fields = useMemo(() => allFields(st.doc), [st.doc]);
  if (!isFillMode(st)) return null;
  const roles = [...new Set(fields.map((f) => prOf(f.node).form?.role).filter(Boolean) as string[])];
  const role = sdtState(st).role;
  const required = fields.filter((f) => prOf(f.node).form?.required);
  const problems = fields.filter((f) => fieldProblem(f.node, st.doc));
  const prot = protectionState(st).mode;
  const submit = () => {
    const bad = allFields(editor.state.doc).filter((f) => fieldProblem(f.node, editor.state.doc));
    if (bad.length) {
      const first = bad[0];
      setSubmitted(null);
      editor.commands.setTextSelection(first.pos + 1);
      editor.view.focus();
      window.alert(`${bad.length} field${bad.length > 1 ? "s" : ""} still need${bad.length > 1 ? "" : "s"} a valid value.`);
      return;
    }
    downloadJson(editor, `${(title || "form").replace(/[^\w-]+/g, "_")}-submission`);
    setSubmitted(new Date().toLocaleTimeString());
  };
  return (
    <Sheet
      variant="soft"
      color="primary"
      data-testid="forms-fill-bar"
      sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5, borderRadius: "sm", flexWrap: "wrap", mb: 0.5 }}
    >
      <Typography level="title-sm">Filling in form</Typography>
      {prot === "forms" && <Chip size="sm">Protected: filling forms only</Chip>}
      {roles.length > 0 && (
        <Select size="sm" value={role ?? ""} onChange={(_, v) => setFillMode(editor, true, (v as string) || null)} sx={{ minWidth: 150 }} slotProps={{ button: { "data-testid": "forms-role" } }}>
          <Option value="">All roles</Option>
          {roles.map((r) => (
            <Option key={r} value={r}>
              Fill as {r}
            </Option>
          ))}
        </Select>
      )}
      <Button size="sm" variant="plain" onClick={() => goToField(editor, -1)} data-testid="forms-prev">
        ‹ Previous
      </Button>
      <Button size="sm" variant="plain" onClick={() => goToField(editor, 1)} data-testid="forms-next">
        Next ›
      </Button>
      <Typography level="body-sm" data-testid="forms-status">
        {required.length - required.filter((f) => !fieldProblem(f.node, st.doc)).length} of {required.length} required left
        {problems.length > required.filter((f) => fieldProblem(f.node, st.doc)).length ? " · check formats" : ""}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {submitted && (
        <Chip size="sm" color="success" data-testid="forms-submitted">
          Submitted {submitted}
        </Chip>
      )}
      <Button size="sm" variant="outlined" onClick={() => downloadJson(editor, "form-data")} data-testid="forms-bar-export">
        Export data
      </Button>
      <Button size="sm" onClick={submit} data-testid="forms-submit">
        Submit
      </Button>
      {prot !== "forms" && (
        <Button size="sm" variant="plain" onClick={() => setFillMode(editor, false)}>
          Exit
        </Button>
      )}
    </Sheet>
  );
}

// --- mount -------------------------------------------------------------------------------

/** FormsUI: dialogs and choosers, mounted once by DocEditor. */
export function FormsUI({ editor, docId }: { editor: Editor | null; docId?: string; title?: string }) {
  const [kind, setKind] = useState<DialogKind | null>(null);
  const [hit, setHit] = useState<SdtHit | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const k = (e as CustomEvent<DialogKind>).detail;
      if (k === "settings") {
        const h = editor ? sdtAt(editor.state) : null;
        if (!h) return;
        setHit(h);
      }
      setKind(k);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [editor]);
  if (!editor) return null;
  return (
    <>
      <Chooser editor={editor} />
      <PictureChooser editor={editor} />
      {kind === "settings" && hit && <SettingsDialog editor={editor} hit={hit} onClose={() => setKind(null)} />}
      {kind === "protect" && <ProtectDialog editor={editor} docId={docId} onClose={() => setKind(null)} />}
    </>
  );
}

/** FillFormBar: the fill-in-form bar (above the page). */
export function FillFormBar({ editor, title }: { editor: Editor | null; title?: string }) {
  return editor ? <FillBar editor={editor} title={title} /> : null;
}
