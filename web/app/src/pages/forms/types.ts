/** Mirrors grownv1.* for Forms (proto snake_case via the gateway). */

export type QuestionType =
  | "short_answer"
  | "paragraph"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "linear_scale"
  | "date"
  | "time"
  | "file_upload";

export interface FormQuestion {
  id: string;
  type: QuestionType;
  title: string;
  description: string;
  required: boolean;
  options: string[];
  scale_min: number;
  scale_max: number;
  scale_min_label: string;
  scale_max_label: string;
  // Quiz fields.
  points: number;
  correct_answers: string[];
  // Section branching: maps option value -> target section id or "__submit__".
  go_to_section: Record<string, string>;
  // When true, this "question" is a section divider (title only, no answer).
  is_section: boolean;
}

export interface FormSettings {
  collect_email: boolean;
  limit_one_response: boolean;
  show_progress_bar: boolean;
  shuffle_questions: boolean;
  confirmation_message: string;
  // Quiz mode toggle.
  is_quiz: boolean;
}

export interface Form {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  description: string;
  questions: FormQuestion[];
  settings: FormSettings;
  accepting: boolean;
  response_count: number;
  created_at: string;
  updated_at: string;
}

export interface ListFormsResponse {
  forms: Form[];
}

export interface CreateFormInput {
  title: string;
  description?: string;
  questions?: FormQuestion[];
}

export interface UpdateFormInput {
  title: string;
  description: string;
  questions: FormQuestion[];
  settings: FormSettings;
  accepting: boolean;
}

export interface FormResponse {
  id: string;
  form_id: string;
  respondent_email: string;
  answers_json: string;
  created_at: string;
  // Quiz score fields (only set when form is a quiz).
  score?: number;
  max_score?: number;
}

export interface ListFormResponsesResponse {
  responses: FormResponse[];
}

export interface FormQuestionSummary {
  question_id: string;
  type: QuestionType;
  title: string;
  counts: Record<string, number>;
  text_answers: string[];
}

export interface FormResponseSummary {
  form_id: string;
  response_count: number;
  questions: FormQuestionSummary[];
}

/** Answer values keyed by question id: string for most types, string[] for checkboxes. */
export type AnswerMap = Record<string, string | string[]>;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_answer: "Short answer",
  paragraph: "Paragraph",
  multiple_choice: "Multiple choice",
  checkboxes: "Checkboxes",
  dropdown: "Dropdown",
  linear_scale: "Linear scale",
  date: "Date",
  time: "Time",
  file_upload: "File upload",
};

export const QUESTION_TYPE_ORDER: QuestionType[] = [
  "short_answer",
  "paragraph",
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "linear_scale",
  "date",
  "time",
  "file_upload",
];

/** The special go_to_section value that means "end the form / submit". */
export const SUBMIT_TARGET = "__submit__";
