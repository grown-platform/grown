// Spelling UI for Docs (M13): the context-menu suggestions, the
// Spelling dialog (Tools ▸ Spelling and grammar, F7) and the Language
// dialog (Tools ▸ Language).
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox, DialogTitle, List, ListDivider, ListItemButton, Modal, ModalClose, ModalDialog, Option, Select, Stack, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { spellService } from "../../lib/spell/service";
import { LANGUAGES, NO_PROOFING, dictionaryFor, languageName } from "../../lib/spell/languages";
import { checkSpellingNow, ignoreAll, misspellingAt, misspellings, replaceMisspelling, type SpellWord } from "./spellcheck";
import { docLanguage, selectionLanguage, setDocLanguage } from "./language";

/** useSuggestions loads the suggestions for a misspelling. */
function useSuggestions(m: SpellWord | null): string[] | null {
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    setList(null);
    if (!m) return;
    let live = true;
    void spellService()
      .suggest(m.lang, m.word, 6)
      .then((s) => live && setList(s));
    return () => {
      live = false;
    };
  }, [m?.word, m?.lang, m?.from]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

/** The spelling items at the top of the editor's context menu. */
export function SpellMenuItems({ editor, m, run }: { editor: Editor; m: SpellWord; run: (fn: () => void) => () => void }) {
  const list = useSuggestions(m);
  return (
    <>
      {list === null ? (
        <ListItemButton disabled role="menuitem">
          Looking for suggestions…
        </ListItemButton>
      ) : list.length === 0 ? (
        <ListItemButton disabled role="menuitem">
          No suggestions
        </ListItemButton>
      ) : (
        list.slice(0, 5).map((s) => (
          <ListItemButton key={s} role="menuitem" data-testid="spell-suggestion" onClick={run(() => replaceMisspelling(editor, m, s))} sx={{ fontWeight: 600 }}>
            {s}
          </ListItemButton>
        ))
      )}
      <ListItemButton role="menuitem" data-testid="spell-ignore" onClick={run(() => void editor.commands.ignoreSpellingOnce(m.from, m.to))}>
        Ignore
      </ListItemButton>
      <ListItemButton role="menuitem" data-testid="spell-ignore-all" onClick={run(() => ignoreAll(editor, m.word))}>
        Ignore all
      </ListItemButton>
      <ListItemButton role="menuitem" data-testid="spell-add" onClick={run(() => spellService().addWord(m.word))}>
        Add to dictionary
      </ListItemButton>
      <ListDivider />
    </>
  );
}

/** spellingAtEvent: the misspelling under a context-menu click. */
export function spellingAtEvent(editor: Editor, e: MouseEvent): SpellWord | null {
  const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
  return hit ? misspellingAt(editor.state, hit.pos) : null;
}

// --- dialogs -------------------------------------------------------------------------------

export type ProofingDialogKind = "spelling" | "language";
const EVENT = "grown-docs-proofing-dialog";

export function openProofingDialog(kind: ProofingDialogKind) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

export function ProofingDialogs({ editor }: { editor: Editor | null }) {
  const [kind, setKind] = useState<ProofingDialogKind | null>(null);
  useEffect(() => {
    const on = (e: Event) => setKind((e as CustomEvent<ProofingDialogKind>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!editor || !kind) return null;
  const close = () => {
    setKind(null);
    editor.commands.focus();
  };
  return kind === "spelling" ? <SpellingDialog editor={editor} onClose={close} /> : <LanguageDialog editor={editor} onClose={close} />;
}

/** Spelling (F7): walk the document's misspellings from the caret. */
function SpellingDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [current, setCurrent] = useState<SpellWord | null>(null);
  const [done, setDone] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(spellService().enabled);
  const next = async (after: number) => {
    const all = await checkSpellingNow(editor);
    const m = all.find((x) => x.from >= after) ?? all[0] ?? null;
    setCurrent(m);
    setDone(!m);
    setChoice(null);
    if (m) editor.chain().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
  };
  useEffect(() => {
    void next(editor.state.selection.from);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useSuggestions(current);
  const pick = choice ?? list?.[0] ?? null;
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 420 }} data-testid="spelling-dialog">
        <ModalClose />
        <DialogTitle>Spelling</DialogTitle>
        {done || !current ? (
          <Typography>{enabled ? "The spelling check is complete." : "Spell checking is off."}</Typography>
        ) : (
          <Stack spacing={1}>
            <Typography level="body-sm">
              Not in dictionary ({languageName(current.lang)}): <b data-testid="spelling-word">{current.word}</b>
            </Typography>
            <List size="sm" variant="outlined" sx={{ maxHeight: 180, overflow: "auto", borderRadius: "sm" }}>
              {(list ?? []).map((s) => (
                <ListItemButton key={s} selected={s === pick} onClick={() => setChoice(s)} onDoubleClick={() => replaceMisspelling(editor, current, s) && void next(current.from + s.length)}>
                  {s}
                </ListItemButton>
              ))}
              {list && !list.length && <Typography level="body-sm" sx={{ p: 1 }}>No suggestions</Typography>}
            </List>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="sm" disabled={!pick} onClick={() => pick && replaceMisspelling(editor, current, pick) && void next(current.from + pick.length)}>
                Change
              </Button>
              <Button size="sm" variant="outlined" onClick={() => {
                  editor.commands.ignoreSpellingOnce(current.from, current.to);
                  void next(current.to);
                }}>
                Ignore
              </Button>
              <Button size="sm" variant="outlined" onClick={() => {
                  ignoreAll(editor, current.word);
                  void next(current.to);
                }}>
                Ignore all
              </Button>
              <Button size="sm" variant="outlined" onClick={() => {
                  spellService().addWord(current.word);
                  void next(current.to);
                }}>
                Add to dictionary
              </Button>
            </Stack>
          </Stack>
        )}
        <Checkbox
          size="sm"
          label="Check spelling as you type"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            editor.commands.setSpellcheck(e.target.checked);
            if (e.target.checked) void next(editor.state.selection.from);
          }}
        />
      </ModalDialog>
    </Modal>
  );
}

/** Language: the selection's (or paragraph's) proofing language and the
 *  document language. */
function LanguageDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [sel, setSel] = useState(() => selectionLanguage(editor));
  const [doc, setDoc] = useState(() => docLanguage(editor));
  const options = useMemo(() => [...LANGUAGES.map((l) => l.tag), NO_PROOFING], []);
  const label = (t: string) => `${languageName(t)}${t !== NO_PROOFING && !dictionaryFor(t) ? " (no dictionary)" : ""}`;
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 420 }} data-testid="language-dialog">
        <ModalClose />
        <DialogTitle>Language</DialogTitle>
        <Typography level="body-sm">
          {editor.state.selection.empty ? "Mark the current paragraph as:" : "Mark the selected text as:"}
        </Typography>
        <Select value={sel} onChange={(_, v) => v && setSel(v)} slotProps={{ button: { "aria-label": "Text language" } }}>
          {options.map((t) => (
            <Option key={t} value={t}>
              {label(t)}
            </Option>
          ))}
        </Select>
        <Typography level="body-sm" sx={{ mt: 1 }}>
          Document language:
        </Typography>
        <Select value={doc} onChange={(_, v) => v && setDoc(v)} slotProps={{ button: { "aria-label": "Document language" } }}>
          {LANGUAGES.map((l) => (
            <Option key={l.tag} value={l.tag}>
              {label(l.tag)}
            </Option>
          ))}
        </Select>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="language-ok"
            onClick={() => {
              if (doc !== docLanguage(editor)) setDocLanguage(editor, doc);
              if (sel !== selectionLanguage(editor)) editor.chain().focus().setTextLanguage(sel).run();
              onClose();
            }}
          >
            OK
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

/** Misspelling count for the status bar. */
export function useMisspellingCount(editor: Editor | null): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const upd = () => setN(misspellings(editor.state).length);
    editor.on("transaction", upd);
    return () => void editor.off("transaction", upd);
  }, [editor]);
  return n;
}

/** Status-bar language and spelling indicator (click: Language dialog). */
export function LanguageStatus({ editor }: { editor: Editor | null }) {
  const [, setTick] = useState(0);
  const count = useMisspellingCount(editor);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", bump);
    const off = spellService().subscribe(bump);
    return () => {
      editor.off("selectionUpdate", bump);
      off();
    };
  }, [editor]);
  if (!editor || editor.isDestroyed) return null;
  const lang = selectionLanguage(editor);
  const on = spellService().enabled;
  return (
    <>
      <Box component="button" data-testid="status-language" onClick={() => openProofingDialog("language")} sx={{ all: "unset", cursor: "pointer" }} title="Proofing language — click to change">
        {languageName(lang)}
      </Box>
      <Box
        component="button"
        data-testid="status-spelling"
        onClick={() => openProofingDialog("spelling")}
        sx={{ all: "unset", cursor: "pointer" }}
        title={on ? "Spelling — click to check (F7)" : "Spell checking is off"}
      >
        {!on ? "Spelling off" : count ? `${count} spelling error${count === 1 ? "" : "s"}` : "No spelling errors"}
      </Box>
    </>
  );
}
