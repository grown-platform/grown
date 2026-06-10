import type { CreateFormInput, FormQuestion, QuestionType } from "./types";

/** Forms accent color, matching the catalog tile. */
export const FORMS_ACCENT = "#7E4E6F";

let seq = 0;
/** newQuestionId returns a process-unique id for a freshly added question. */
export function newQuestionId(): string {
  seq += 1;
  return `q-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** blankQuestion builds a default question of the given type. */
export function blankQuestion(
  type: QuestionType = "multiple_choice",
): FormQuestion {
  const needsOptions =
    type === "multiple_choice" || type === "checkboxes" || type === "dropdown";
  return {
    id: newQuestionId(),
    type,
    title: "",
    description: "",
    required: false,
    options: needsOptions ? ["Option 1"] : [],
    scale_min: type === "linear_scale" ? 1 : 0,
    scale_max: type === "linear_scale" ? 5 : 0,
    scale_min_label: "",
    scale_max_label: "",
    points: 0,
    correct_answers: [],
    go_to_section: {},
    is_section: false,
  };
}

/** blankSection builds a section-divider pseudo-question. */
export function blankSection(): FormQuestion {
  return {
    ...blankQuestion("short_answer"),
    type: "short_answer",
    is_section: true,
    title: "Section",
  };
}

/** Templates gallery — clicking one creates a pre-populated form. */
export interface FormTemplate {
  id: string;
  name: string;
  category: "Personal" | "Work" | "Education";
  input: CreateFormInput;
}

function q(
  partial: Partial<FormQuestion> & { type: QuestionType; title: string },
): FormQuestion {
  return { ...blankQuestion(partial.type), ...partial, id: newQuestionId() };
}

export const TEMPLATES: FormTemplate[] = [
  {
    id: "contact-info",
    name: "Contact information",
    category: "Personal",
    input: {
      title: "Contact information",
      description: "Share your contact details.",
      questions: [
        q({ type: "short_answer", title: "Name", required: true }),
        q({ type: "short_answer", title: "Email", required: true }),
        q({ type: "short_answer", title: "Phone number" }),
        q({ type: "paragraph", title: "Address" }),
      ],
    },
  },
  {
    id: "party-invite",
    name: "Party invite",
    category: "Personal",
    input: {
      title: "Party invite",
      description: "Let us know if you can make it!",
      questions: [
        q({ type: "short_answer", title: "Name", required: true }),
        q({
          type: "multiple_choice",
          title: "Can you attend?",
          options: ["Yes", "No", "Maybe"],
          required: true,
        }),
        q({ type: "short_answer", title: "How many guests?" }),
      ],
    },
  },
  {
    id: "rsvp",
    name: "RSVP",
    category: "Work",
    input: {
      title: "RSVP",
      description: "Please respond by the date provided.",
      questions: [
        q({ type: "short_answer", title: "Name", required: true }),
        q({
          type: "multiple_choice",
          title: "Will you attend?",
          options: ["Attending", "Not attending"],
          required: true,
        }),
        q({
          type: "checkboxes",
          title: "Dietary restrictions",
          options: ["Vegetarian", "Vegan", "Gluten-free", "None"],
        }),
      ],
    },
  },
  {
    id: "event-registration",
    name: "Event registration",
    category: "Work",
    input: {
      title: "Event registration",
      description: "Register for the upcoming event.",
      questions: [
        q({ type: "short_answer", title: "Full name", required: true }),
        q({ type: "short_answer", title: "Email", required: true }),
        q({
          type: "dropdown",
          title: "Which session?",
          options: ["Morning", "Afternoon", "Evening"],
          required: true,
        }),
        q({ type: "date", title: "Preferred date" }),
      ],
    },
  },
  {
    id: "course-evaluation",
    name: "Course evaluation",
    category: "Education",
    input: {
      title: "Course evaluation",
      description: "Help us improve this course.",
      questions: [
        q({
          type: "linear_scale",
          title: "Overall rating",
          scale_min: 1,
          scale_max: 5,
          scale_min_label: "Poor",
          scale_max_label: "Excellent",
          required: true,
        }),
        q({
          type: "multiple_choice",
          title: "Would you recommend this course?",
          options: ["Yes", "No"],
        }),
        q({ type: "paragraph", title: "What could be improved?" }),
      ],
    },
  },
  {
    id: "event-feedback",
    name: "Event feedback",
    category: "Education",
    input: {
      title: "Event feedback",
      description: "Tell us what you thought.",
      questions: [
        q({
          type: "linear_scale",
          title: "How would you rate the event?",
          scale_min: 1,
          scale_max: 5,
          required: true,
        }),
        q({
          type: "checkboxes",
          title: "What did you enjoy?",
          options: ["Content", "Speakers", "Venue", "Networking"],
        }),
        q({ type: "paragraph", title: "Additional comments" }),
      ],
    },
  },
];
