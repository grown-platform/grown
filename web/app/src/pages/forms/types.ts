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
  | "file_upload"
  | "multiple_choice_grid"
  | "checkbox_grid"
  | "rating";

/** Response-validation rule kinds and their ops (Google Forms parity). */
export type ValidationKind = "number" | "text" | "length" | "regex" | "checkbox";

export interface FormValidation {
  kind: ValidationKind | "";
  op: string;
  value?: string;
  /** Upper bound for between / not_between. */
  value2?: string;
  /** Replaces the default error message when set. */
  error_text?: string;
}

/** Short-answer input formats, in the spirit of OnlyOffice text-form formats. */
export type TextFormat =
  | ""
  | "digits"
  | "letters"
  | "phone"
  | "zip"
  | "credit_card"
  | "mask";

export type RatingIcon = "star" | "heart" | "thumb";

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
  // --- CC4 (all optional: older forms don't carry them) ---
  validation?: FormValidation | null;
  text_format?: TextFormat;
  /** 9 digit, a/A letter, O digit-or-letter, X any, \c literal c. */
  mask?: string;
  /** Grid rows; the columns are `options`. */
  rows?: string[];
  limit_one_per_column?: boolean;
  rating_icon?: RatingIcon;
  /** Section dividers: "" = next section, a section id or SUBMIT_TARGET. */
  after_section?: string;
}

export interface FormSettings {
  collect_email: boolean;
  limit_one_response: boolean;
  show_progress_bar: boolean;
  shuffle_questions: boolean;
  confirmation_message: string;
  // Quiz mode toggle.
  is_quiz: boolean;
  /** Where to go after the implicit first section (see after_section). */
  after_first_section?: string;
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

/** GET /forms/{id}/my-response: has the signed-in user responded? */
export interface MyResponseStatus {
  responded: boolean;
  response_id?: string;
  created_at?: string;
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
  grid_rows?: { row: string; counts: Record<string, number> }[];
  answered_count?: number;
  skipped_count?: number;
}

export interface FormResponseSummary {
  form_id: string;
  response_count: number;
  questions: FormQuestionSummary[];
}

/** Grid answers are keyed by row: a column (multiple-choice grid) or columns (checkbox grid). */
export type GridAnswer = Record<string, string | string[]>;

/** Answer values keyed by question id: string for most types, string[] for
 *  checkboxes, a row-keyed object for grids. */
export type AnswerValue = string | string[] | GridAnswer;
export type AnswerMap = Record<string, AnswerValue>;

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
  multiple_choice_grid: "Multiple choice grid",
  checkbox_grid: "Checkbox grid",
  rating: "Rating",
};

export const QUESTION_TYPE_ORDER: QuestionType[] = [
  "short_answer",
  "paragraph",
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "linear_scale",
  "rating",
  "multiple_choice_grid",
  "checkbox_grid",
  "date",
  "time",
  "file_upload",
];

/** The special go_to_section value that means "end the form / submit". */
export const SUBMIT_TARGET = "__submit__";

/** Joins a grid row and column in a grid question's correct_answers. */
export const GRID_KEY_SEP = "\u001f";
