// "Limit to 1 response" (Google Forms' "Limit to 1 response"): a signed-in
// respondent may submit once. The server enforces it (409 on a second
// submission); these helpers decide what the fill view shows.
import type { Form, MyResponseStatus } from "./types";

/** What the fill view renders in place of (or instead of) the questions. */
export type FillGate = "form" | "already_responded";

/** True when the form limits each respondent to one response. */
export function limitsOneResponse(form: Pick<Form, "settings"> | null): boolean {
  return !!form?.settings?.limit_one_response;
}

/**
 * The gate for a loaded form: a limited form the user already answered shows
 * "You've already responded". A failed or pending status lookup falls back to
 * the form (the server still refuses a second submission).
 */
export function fillGate(
  form: Pick<Form, "settings"> | null,
  mine: MyResponseStatus | null,
): FillGate {
  return limitsOneResponse(form) && mine?.responded
    ? "already_responded"
    : "form";
}

/** True for the server's "already responded" rejection (HTTP 409). */
export function isAlreadyRespondedError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: unknown }).status === 409
  );
}
