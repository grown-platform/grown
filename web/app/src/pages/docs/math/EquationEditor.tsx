// Equation panel (Docs M11): edits one `math` node. The field takes the
// linear format with math autocorrect as you type (Unicode, like Word) or
// LaTeX; the toolbar inserts structures (fractions, scripts, radicals,
// integrals, large operators, brackets, functions, accents, limits,
// matrices); the preview is the built-up (professional) equation.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Box,
  Button,
  Checkbox,
  Dropdown,
  ListItemDecorator,
  Menu,
  MenuButton,
  MenuItem,
  Sheet,
  ToggleButtonGroup,
  Typography,
} from "@mui/joy";
import { MathInput, correctWords, linearWithCaret } from "./autocorrect";
import { type Content, type MObj, isEmptyContent, run } from "./model";
import { parseLinear } from "./linear";
import { latexContent, parseLatex } from "./latex";
import { TEMPLATES, toProfessional } from "./ops";
import { contentOf, renderMath } from "./MathNode";

interface EquationEditorProps {
  editor: Editor;
  pos: number;
  isNew: boolean;
  onClose: () => void;
}

type Mode = "unicode" | "latex";

function Preview({ content, display }: { content: Content; display: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderMath(ref.current, content, display);
  }, [content, display]);
  return <Box ref={ref} data-testid="equation-preview" sx={{ minHeight: 32, py: 1, overflowX: "auto", textAlign: "center" }} />;
}

export function EquationEditor({ editor, pos, isNew, onClose }: EquationEditorProps) {
  const node = editor.state.doc.nodeAt(pos);
  const initial = useMemo(() => (node && node.type.name === "math" ? contentOf(node) : [run()]), [node]);
  const engine = useRef(new MathInput(initial));
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [mode, setMode] = useState<Mode>("unicode");
  const [free, setFree] = useState<string | null>(null);
  const [latex, setLatex] = useState("");
  const [display, setDisplay] = useState<boolean>(!!node?.attrs.display);
  const input = useRef<HTMLTextAreaElement>(null);

  const linear = linearWithCaret(engine.current);
  const value = mode === "latex" ? latex : free ?? linear.text;

  // The equation shown in the preview and saved on Done.
  const current = (): Content => {
    if (mode === "latex") return parseLatex(latex);
    if (free !== null) return parseLinear(correctWords(free));
    return engine.current.root;
  };
  const preview = mode === "latex" ? parseLatex(latex) : free !== null ? parseLinear(correctWords(free)) : engine.current.root;

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Keep the field's caret where the engine's caret is.
  useLayoutEffect(() => {
    const ta = input.current;
    if (!ta || mode !== "unicode" || free !== null) return;
    if (document.activeElement === ta) ta.setSelectionRange(linear.caret, linear.caret);
  });

  // Typing at the engine's caret goes through math autocorrect; editing
  // anywhere else switches to free editing of the linear text.
  useEffect(() => {
    const ta = input.current;
    if (!ta) return;
    const onBeforeInput = (e: InputEvent) => {
      if (mode !== "unicode" || free !== null) return;
      const at = linearWithCaret(engine.current).caret;
      const atCaret = ta.selectionStart === at && ta.selectionEnd === at;
      if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
        e.preventDefault();
        return;
      }
      if (!atCaret) {
        setFree(ta.value);
        return;
      }
      if (e.inputType === "insertText" && e.data) {
        e.preventDefault();
        engine.current.type(e.data);
        bump();
      } else if (e.inputType === "deleteContentBackward") {
        e.preventDefault();
        engine.current.backspace();
        bump();
      } else if (e.inputType !== "insertCompositionText") {
        setFree(ta.value);
      }
    };
    ta.addEventListener("beforeinput", onBeforeInput);
    return () => ta.removeEventListener("beforeinput", onBeforeInput);
  });

  const insertTemplate = (make: () => MObj) => {
    if (mode === "latex") {
      const eq = parseLatex(latex);
      const m = new MathInput(eq);
      m.insertObject(make());
      setLatex(latexContent(m.root));
      return;
    }
    if (free !== null) {
      engine.current = new MathInput(parseLinear(correctWords(free)));
      setFree(null);
    }
    engine.current.insertObject(make());
    bump();
    input.current?.focus();
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    const eq = current();
    if (m === "latex") setLatex(latexContent(eq));
    else {
      engine.current = new MathInput(eq);
      setFree(null);
    }
    setMode(m);
  };

  const done = () => {
    const eq = toProfessional(current());
    const at = pos;
    const n = editor.state.doc.nodeAt(at);
    if (n && n.type.name === "math") {
      if (isEmptyContent(eq) && isNew) editor.chain().focus().deleteRange({ from: at, to: at + n.nodeSize }).run();
      else editor.chain().focus().updateEquation(at, { content: eq, display }).setTextSelection(at + n.nodeSize).run();
    }
    onClose();
  };
  const cancel = () => {
    const n = editor.state.doc.nodeAt(pos);
    if (isNew && n && n.type.name === "math" && isEmptyContent(contentOf(n)))
      editor.chain().focus().deleteRange({ from: pos, to: pos + n.nodeSize }).run();
    else editor.commands.focus();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      done();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (mode === "unicode" && free === null && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.shiftKey && !mod) {
      // Arrow keys move the equation caret (in and out of arguments).
      e.preventDefault();
      if (e.key === "ArrowRight") engine.current.moveRight();
      else engine.current.moveLeft();
      bump();
    } else if (mode === "unicode" && free === null && mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      e.preventDefault();
      if (e.key === "y" || e.shiftKey) engine.current.redo();
      else engine.current.undo();
      bump();
    }
  };

  // Place the panel under the equation, inside the viewport.
  let top = 120;
  let left = 120;
  try {
    const c = editor.view.coordsAtPos(pos);
    top = Math.min(c.bottom + 8, window.innerHeight - 260);
    left = Math.max(8, Math.min(c.left - 24, window.innerWidth - 600));
  } catch {
    /* position unknown */
  }

  return (
    <Sheet
      variant="outlined"
      data-testid="equation-editor"
      onMouseDown={(e) => e.stopPropagation()}
      sx={{ position: "fixed", top, left, zIndex: 1300, width: 580, maxWidth: "calc(100vw - 16px)", p: 1.5, borderRadius: "md", boxShadow: "lg", display: "flex", flexDirection: "column", gap: 1 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }} role="toolbar" aria-label="Equation tools">
        {TEMPLATES.map((g) => (
          <Dropdown key={g.id}>
            <MenuButton size="sm" variant="plain" data-testid={`eq-group-${g.id}`}>
              {g.label}
            </MenuButton>
            <Menu size="sm" sx={{ zIndex: 1400 }}>
              {g.items.map((t) => (
                <MenuItem key={t.id} data-testid={`eq-tpl-${t.id}`} onClick={() => insertTemplate(t.make)}>
                  <ListItemDecorator sx={{ minWidth: 72, fontFamily: "Cambria Math, STIX Two Math, serif" }}>{t.preview}</ListItemDecorator>
                  {t.label}
                </MenuItem>
              ))}
            </Menu>
          </Dropdown>
        ))}
      </Box>
      <textarea
        ref={input}
        data-testid="equation-input"
        aria-label={mode === "latex" ? "Equation (LaTeX)" : "Equation (linear format)"}
        rows={1}
        spellCheck={false}
        value={value}
        onChange={(e) => {
          if (mode === "latex") setLatex(e.target.value);
          else setFree(e.target.value);
        }}
        onKeyDown={onKeyDown}
        placeholder={mode === "latex" ? "\\frac{a}{b}" : "Type an equation, e.g. a/b, x^2, \\sqrt (x+1), \\sum_(i=1)^n i"}
        style={{ width: "100%", resize: "vertical", fontFamily: "'Cambria Math', 'STIX Two Math', serif", fontSize: 16, padding: 6, boxSizing: "border-box" }}
      />
      <Preview content={preview} display={display} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <ToggleButtonGroup size="sm" value={mode} onChange={(_, v) => v && switchMode(v as Mode)}>
          <Button value="unicode" data-testid="eq-mode-unicode">
            Unicode
          </Button>
          <Button value="latex" data-testid="eq-mode-latex">
            LaTeX
          </Button>
        </ToggleButtonGroup>
        <Checkbox size="sm" label="Display (own line)" checked={display} onChange={(e) => setDisplay(e.target.checked)} data-testid="eq-display" />
        <Typography level="body-xs" sx={{ opacity: 0.6, flex: 1 }}>
          Space or an operator builds up · Enter to finish
        </Typography>
        <Button size="sm" variant="plain" color="neutral" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={done} data-testid="equation-done">
          Done
        </Button>
      </Box>
    </Sheet>
  );
}
