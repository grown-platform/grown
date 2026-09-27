// The References dialogs hand the caret back to the editor within the
// click that closes them. Regression: after Insert in the cross-reference
// dialog, the editor's view.focus() ran while the modal's focus trap was
// still mounted, so the trap took focus back and ProseMirror skipped
// writing its selection to the DOM (it only does that when it has focus);
// TipTap's focus() then waited a frame. Text typed in that frame went
// where the browser had parked its caret, at the start of the document
// (inside the referenced heading, next to its bookmark), and was lost:
// docs-references.spec.ts saw `“Scope.` instead of `“Scope”.` about 1
// run in 5.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TextSelection } from "@tiptap/pm/state";
import { makeEditor } from "./harness";
import { ReferenceDialogs, openReferenceDialog } from "../ReferenceDialogs";

afterEach(cleanup);

describe("reference dialogs: focus after insert", () => {
  it("the editor has focus and its caret in the DOM as soon as Insert is clicked", () => {
    const editor = makeEditor("<h2>Scope</h2><p>See “</p>");
    const end = TextSelection.atEnd(editor.state.doc).from;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    editor.view.focus();
    render(<ReferenceDialogs editor={editor as never} />);
    act(() => openReferenceDialog("crossref"));
    // The dialog opens on "Heading" references.
    fireEvent.click(screen.getByText("Scope", { selector: "[data-testid=crossref-list] *" }));
    fireEvent.click(screen.getByTestId("crossref-insert"));
    // Synchronously, before any animation frame: keys typed now must land
    // after the new field.
    expect(screen.queryByTestId("ref-dialog-crossref")).toBeNull();
    expect(document.activeElement).toBe(editor.view.dom);
    const para = editor.view.dom.querySelector("p")!;
    expect(para.querySelector(".doc-field")?.textContent).toBe("Scope");
    const sel = document.getSelection()!;
    expect(sel.anchorNode && para.contains(sel.anchorNode)).toBe(true);
    const at = editor.view.posAtDOM(sel.anchorNode!, sel.anchorOffset);
    expect(at).toBe(editor.state.selection.from);
    expect(editor.state.doc.resolve(at).nodeBefore?.type.name).toBe("field");
  });
});
