import { describe, it, expect } from "vitest";
import {
  FORMS_ACCENT,
  newQuestionId,
  blankQuestion,
  blankSection,
  TEMPLATES,
} from "./helpers";
import type { FormQuestion, QuestionType } from "./types";

describe("FORMS_ACCENT", () => {
  it("is the catalog accent hex", () => {
    expect(FORMS_ACCENT).toBe("#7E4E6F");
  });
});

describe("newQuestionId", () => {
  it("returns a q-prefixed string", () => {
    expect(newQuestionId()).toMatch(/^q-/);
  });

  it("returns a unique id on each call", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) ids.add(newQuestionId());
    expect(ids.size).toBe(1000);
  });
});

describe("blankQuestion", () => {
  it("defaults to multiple_choice when no type is given", () => {
    const qn = blankQuestion();
    expect(qn.type).toBe("multiple_choice");
  });

  // Types that get a seeded "Option 1".
  const withOptions: QuestionType[] = [
    "multiple_choice",
    "checkboxes",
    "dropdown",
  ];
  // A representative sample of types that do not.
  const withoutOptions: QuestionType[] = [
    "short_answer",
    "paragraph",
    "linear_scale",
    "date",
    "time",
    "file_upload",
  ];

  it.each(withOptions)("seeds a default option for %s", (type) => {
    expect(blankQuestion(type).options).toEqual(["Option 1"]);
  });

  it.each(withoutOptions)("leaves options empty for %s", (type) => {
    expect(blankQuestion(type).options).toEqual([]);
  });

  it("sets a 1..5 scale only for linear_scale", () => {
    const scale = blankQuestion("linear_scale");
    expect(scale.scale_min).toBe(1);
    expect(scale.scale_max).toBe(5);

    const nonScale = blankQuestion("short_answer");
    expect(nonScale.scale_min).toBe(0);
    expect(nonScale.scale_max).toBe(0);
  });

  it("returns the full default shape with the requested type", () => {
    const qn = blankQuestion("paragraph");
    const { id, ...rest } = qn;
    expect(id).toMatch(/^q-/);
    expect(rest).toEqual<Omit<FormQuestion, "id">>({
      type: "paragraph",
      title: "",
      description: "",
      required: false,
      options: [],
      scale_min: 0,
      scale_max: 0,
      scale_min_label: "",
      scale_max_label: "",
      points: 0,
      correct_answers: [],
      go_to_section: {},
      is_section: false,
    });
  });

  it("gives each question a distinct id", () => {
    expect(blankQuestion().id).not.toBe(blankQuestion().id);
  });
});

describe("blankSection", () => {
  it("is a short_answer section divider titled 'Section'", () => {
    const s = blankSection();
    expect(s.type).toBe("short_answer");
    expect(s.is_section).toBe(true);
    expect(s.title).toBe("Section");
  });

  it("has no options (built from short_answer base)", () => {
    expect(blankSection().options).toEqual([]);
  });

  it("has a fresh unique id", () => {
    expect(blankSection().id).not.toBe(blankSection().id);
  });
});

describe("TEMPLATES", () => {
  it("exposes the expected template ids", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      "contact-info",
      "party-invite",
      "rsvp",
      "event-registration",
      "course-evaluation",
      "event-feedback",
    ]);
  });

  it("only uses known categories", () => {
    const allowed = new Set(["Personal", "Work", "Education"]);
    for (const t of TEMPLATES) {
      expect(allowed.has(t.category)).toBe(true);
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    "template %s has a titled input with at least one question",
    (_id, t) => {
      expect(t.input.title).toBeTruthy();
      expect(t.input.questions && t.input.questions.length).toBeGreaterThan(0);
    },
  );

  it("gives every question across all templates a unique id", () => {
    const ids = TEMPLATES.flatMap((t) =>
      (t.input.questions ?? []).map((qn) => qn.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("seeds option-backed questions with concrete options", () => {
    for (const t of TEMPLATES) {
      for (const qn of t.input.questions ?? []) {
        if (
          qn.type === "multiple_choice" ||
          qn.type === "checkboxes" ||
          qn.type === "dropdown"
        ) {
          expect(qn.options.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("carries the configured scale on linear_scale questions", () => {
    const evalForm = TEMPLATES.find((t) => t.id === "course-evaluation")!;
    const rating = evalForm.input.questions!.find(
      (qn) => qn.type === "linear_scale",
    )!;
    expect(rating.scale_min).toBe(1);
    expect(rating.scale_max).toBe(5);
    expect(rating.scale_min_label).toBe("Poor");
    expect(rating.scale_max_label).toBe("Excellent");
  });
});
