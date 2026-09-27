// M13 dialogs: the keyboard shortcut list (Ctrl+/) generated from
// shortcuts.ts, and the outline view: the deck as headings and lists for
// screen readers, with the missing-alt-text check.

import { useMemo, useState } from "react";
import { Box, Button, DialogContent, DialogTitle, Input, Link, Modal, ModalClose, ModalDialog, Typography } from "@mui/joy";
import type { Slide, SlideElement } from "./model";
import { filterShortcuts, formatKeys, SHORTCUTS } from "./shortcuts";
import { slideOutline } from "./printLayout";
import { elementLabel, missingAltText } from "./a11y";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => filterShortcuts(q), [q]);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  const mac = isMac();
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="shortcuts-title" sx={{ width: "min(720px, 96vw)", maxHeight: "90vh" }} data-testid="shortcuts-dialog">
        <ModalClose />
        <DialogTitle id="shortcuts-title">Keyboard shortcuts</DialogTitle>
        <Input
          size="sm"
          autoFocus
          placeholder="Search shortcuts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { "aria-label": "Search shortcuts" } }}
        />
        <DialogContent sx={{ overflow: "auto" }}>
          {groups.map((g) => {
            const list = rows.filter((r) => r.group === g);
            if (!list.length) return null;
            return (
              <Box key={g} component="section" aria-labelledby={`sc-${g}`} sx={{ mb: 2 }}>
                <Typography id={`sc-${g}`} level="title-sm" component="h3" sx={{ mb: 0.5 }}>
                  {g}
                </Typography>
                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <tbody>
                    {list.map((s) => (
                      <Box component="tr" key={s.label} sx={{ borderTop: "1px solid", borderColor: "divider" }}>
                        <Box component="th" scope="row" sx={{ textAlign: "left", fontWeight: 400, py: 0.5, pr: 2 }}>
                          {s.label}
                        </Box>
                        <Box component="td" sx={{ textAlign: "right", py: 0.5, whiteSpace: "nowrap" }}>
                          {s.keys.map((k, i) => (
                            <span key={k}>
                              {i > 0 && <span style={{ opacity: 0.5 }}> or </span>}
                              <Box component="kbd" sx={{ fontFamily: "inherit", fontSize: 12, px: 0.5, py: 0.1, border: "1px solid", borderColor: "neutral.outlinedBorder", borderRadius: 4 }}>
                                {formatKeys(k, mac)}
                              </Box>
                            </span>
                          ))}
                        </Box>
                      </Box>
                    ))}
                  </tbody>
                </Box>
              </Box>
            );
          })}
          {!rows.length && <Typography level="body-sm">No shortcut matches “{q}”.</Typography>}
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}

/** OutlineDialog: slides as headings, body text as nested lists, notes,
 *  and objects that need alt text, each with a way to jump there. */
export function OutlineDialog({
  open,
  onClose,
  slides,
  onGoto,
  onAltText,
}: {
  open: boolean;
  onClose: () => void;
  slides: readonly Slide[];
  onGoto: (slide: number) => void;
  onAltText: (slide: number, el: SlideElement) => void;
}) {
  const outline = useMemo(() => (open ? slides.map((s, i) => slideOutline(s, i)) : []), [open, slides]);
  const missing = useMemo(() => (open ? missingAltText(slides) : []), [open, slides]);
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="outline-title" sx={{ width: "min(760px, 96vw)", maxHeight: "90vh" }} data-testid="outline-dialog">
        <ModalClose />
        <DialogTitle id="outline-title">Outline</DialogTitle>
        <DialogContent sx={{ overflow: "auto" }}>
          <Box component="section" aria-labelledby="a11y-check" sx={{ mb: 2, p: 1.5, borderRadius: "sm", bgcolor: missing.length ? "warning.softBg" : "success.softBg" }}>
            <Typography id="a11y-check" level="title-sm" component="h2">
              Accessibility check
            </Typography>
            {missing.length ? (
              <>
                <Typography level="body-sm">
                  {missing.length === 1 ? "1 object needs" : `${missing.length} objects need`} alt text for screen readers.
                </Typography>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }} data-testid="missing-alt">
                  {missing.map((m) => (
                    <li key={`${m.slide}:${m.el.id}`}>
                      <Link component="button" onClick={() => onAltText(m.slide, m.el)}>
                        Slide {m.slide + 1}: {elementLabel(m.el)}
                      </Link>
                    </li>
                  ))}
                </Box>
              </>
            ) : (
              <Typography level="body-sm">Every picture, chart and clip has alt text.</Typography>
            )}
          </Box>
          <Box component="ol" sx={{ m: 0, pl: 3 }} data-testid="outline-list">
            {outline.map((e) => {
              const notes = (slides[e.index].notes || "").trim();
              return (
                <Box component="li" key={e.index} sx={{ mb: 1.5 }}>
                  <Typography level="title-md" component="h3" sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
                    {e.title || "Untitled slide"}
                    {slides[e.index].hidden && (
                      <Typography level="body-xs" component="span">
                        (hidden)
                      </Typography>
                    )}
                    <Button size="sm" variant="plain" onClick={() => onGoto(e.index)} aria-label={`Go to slide ${e.index + 1}`} sx={{ ml: "auto", minHeight: 0, py: 0 }}>
                      Go to slide
                    </Button>
                  </Typography>
                  {e.body.length > 0 && <OutlineBody items={e.body} />}
                  {notes && (
                    <Typography level="body-sm" sx={{ mt: 0.5, whiteSpace: "pre-wrap", opacity: 0.8 }}>
                      <strong>Notes: </strong>
                      {notes}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}

/** Body lines as properly nested lists (level n → n levels deep). */
function OutlineBody({ items }: { items: { text: string; level: number }[] }) {
  type Node = { text: string; children: Node[] };
  const root: Node[] = [];
  const stack: { level: number; list: Node[] }[] = [{ level: -1, list: root }];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
    const node: Node = { text: it.text, children: [] };
    stack[stack.length - 1].list.push(node);
    stack.push({ level: it.level, list: node.children });
  }
  const render = (list: Node[]) => (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {list.map((n, i) => (
        <li key={i}>
          <Typography level="body-sm" component="span">
            {n.text}
          </Typography>
          {n.children.length > 0 && render(n.children)}
        </li>
      ))}
    </Box>
  );
  return render(root);
}
