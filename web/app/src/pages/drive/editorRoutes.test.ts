import { describe, expect, it } from "vitest";
import { editorAppFor } from "./editorRoutes";

const f = (name: string, mime_type: string) => ({ name, mime_type });

describe("editorAppFor", () => {
  it("maps office types by mime", () => {
    expect(
      editorAppFor(
        f(
          "a.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    ).toBe("docs");
    expect(
      editorAppFor(
        f(
          "a.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      ),
    ).toBe("sheets");
    expect(editorAppFor(f("a.csv", "text/csv"))).toBe("sheets");
    expect(
      editorAppFor(
        f("a.odp", "application/vnd.oasis.opendocument.presentation"),
      ),
    ).toBe("slides");
    expect(editorAppFor(f("a.pdf", "application/pdf"))).toBe("pdf");
  });

  it("opens Visio drawings in Whiteboard, also when uploaded as octet-stream", () => {
    expect(editorAppFor(f("flow.vsdx", "application/octet-stream"))).toBe(
      "whiteboard",
    );
    expect(editorAppFor(f("Flow.VSDX", ""))).toBe("whiteboard");
    expect(
      editorAppFor(f("flow", "application/vnd.ms-visio.drawing.main+xml")),
    ).toBe("whiteboard");
  });

  it("has no editor for other files", () => {
    expect(editorAppFor(f("photo.png", "image/png"))).toBeNull();
    expect(editorAppFor(f("notes.txt", "text/plain"))).toBeNull();
  });
});
