import type {
  Form,
  ListFormsResponse,
  CreateFormInput,
  UpdateFormInput,
  FormResponse,
  ListFormResponsesResponse,
  FormResponseSummary,
  AnswerMap,
} from "./types";

const API_BASE = "/api/v1";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export async function listForms(): Promise<Form[]> {
  const r = await jsonFetch<ListFormsResponse>("/forms");
  return r.forms ?? [];
}

export function createForm(input: CreateFormInput): Promise<Form> {
  return jsonFetch<Form>("/forms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getForm(id: string): Promise<Form> {
  return jsonFetch<Form>(`/forms/${id}`);
}

export function updateForm(id: string, input: UpdateFormInput): Promise<Form> {
  return jsonFetch<Form>(`/forms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function trashForm(id: string): Promise<void> {
  await jsonFetch<unknown>(`/forms/${id}`, { method: "DELETE" });
}

export function submitResponse(
  formId: string,
  answers: AnswerMap,
  respondentEmail?: string,
): Promise<FormResponse> {
  return jsonFetch<FormResponse>(`/forms/${formId}/responses`, {
    method: "POST",
    body: JSON.stringify({
      form_id: formId,
      respondent_email: respondentEmail ?? "",
      answers_json: JSON.stringify(answers),
    }),
  });
}

export async function listResponses(formId: string): Promise<FormResponse[]> {
  const r = await jsonFetch<ListFormResponsesResponse>(
    `/forms/${formId}/responses`,
  );
  return r.responses ?? [];
}

export function getSummary(formId: string): Promise<FormResponseSummary> {
  return jsonFetch<FormResponseSummary>(`/forms/${formId}/summary`);
}

export async function deleteResponses(formId: string): Promise<void> {
  await jsonFetch<unknown>(`/forms/${formId}/responses`, { method: "DELETE" });
}
