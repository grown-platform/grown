import { test, expect, type Locator, type Page } from "@playwright/test";
import * as path from "node:path";
import { BASE_URL } from "./helpers";

// Forms CC4: build a form in the editor with a go-to-section branch, a
// validated short answer and a multiple-choice grid; fill it twice as a
// respondent (once down each branch), hit a validation error on the way,
// and check the stored responses, the skipped-section handling in the
// summary, and that the server enforces the same validation.
//
// Screenshots go to GROWN_CC4_SHOT_DIR (default test-results/forms).

const SHOT_DIR =
  process.env.GROWN_CC4_SHOT_DIR || path.join("test-results", "forms");

async function createForm(page: Page, title: string): Promise<string> {
  const res = await page.request.post(`${BASE_URL}/api/v1/forms`, {
    data: { title },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

async function getForm(page: Page, id: string) {
  const res = await page.request.get(`${BASE_URL}/api/v1/forms/${id}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** Open a Joy Select by its accessible name and pick an option. */
async function choose(scope: Page | Locator, page: Page, name: string, option: string | RegExp) {
  await scope.getByRole("combobox", { name }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}

const questionCards = (page: Page) =>
  page.locator('[data-testid^="question-"]');
const sectionCards = (page: Page) => page.locator('[data-testid^="section-"]');

test.describe.serial("forms: validation, grid and branching", () => {
  let formId = "";

  test.afterAll(async ({ request }) => {
    if (formId)
      await request.delete(`${BASE_URL}/api/v1/forms/${formId}`).catch(() => {});
  });

  test("build a form with a branch, a validated field and a grid", async ({ page }) => {
    formId = await createForm(page, "e2e CC4 pets");
    await page.goto(`/forms/d/${formId}`);

    // Q1: multiple choice "Pet?" with Cat / Dog.
    await page.getByTestId("add-question").click();
    const pet = questionCards(page).nth(0);
    await pet.getByPlaceholder("Question").fill("Pet?");
    await pet.getByLabel("Option 1", { exact: true }).fill("Cat");
    await pet.getByRole("button", { name: "Add option" }).click();
    await pet.getByLabel("Option 2", { exact: true }).fill("Dog");

    // Section 2 "Cats" with a validated short answer.
    await page.getByTestId("add-section").click();
    await sectionCards(page).nth(0).getByPlaceholder("Section title").fill("Cats");
    await page.getByTestId("add-question").click();
    const age = questionCards(page).nth(1);
    await choose(age, page, "Question types", "Short answer");
    await age.getByPlaceholder("Question").fill("Cat age");
    await age.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Response validation" }).click();
    await choose(age, page, "Validation type", "Number");
    await expect(age.getByRole("combobox", { name: "Validation type" })).toHaveText("Number");
    await choose(age, page, "Validation condition", "Between");
    await expect(age.getByRole("combobox", { name: "Validation condition" })).toHaveText("Between");
    await age.getByLabel("Validation value", { exact: true }).fill("1");
    await age.getByLabel("Validation upper bound", { exact: true }).fill("30");
    await age.getByLabel("Custom error text", { exact: true }).fill("Cat ages are 1-30");

    // Section 3 "Dogs" with a required multiple-choice grid.
    await page.getByTestId("add-section").click();
    await sectionCards(page).nth(1).getByPlaceholder("Section title").fill("Dogs");
    await page.getByTestId("add-question").click();
    const walks = questionCards(page).nth(2);
    await choose(walks, page, "Question types", "Multiple choice grid");
    await walks.getByPlaceholder("Question").fill("Walks");
    await walks.getByLabel("Row 1", { exact: true }).fill("Mon");
    await walks.getByLabel("Row 2", { exact: true }).fill("Tue");
    await walks.getByLabel("Column 1", { exact: true }).fill("AM");
    await walks.getByLabel("Column 2", { exact: true }).fill("PM");
    await walks.getByLabel("Required", { exact: true }).click();

    // Branch: Cat -> Cats, Dog -> Dogs; after the Cats section, submit.
    await pet.getByPlaceholder("Question").click(); // activates the card
    await choose(pet, page, "Go to section for option Cat", /Cats/);
    await choose(pet, page, "Go to section for option Dog", /Dogs/);
    await choose(page, page, "After section 2", "Submit form");

    await expect
      .poll(async () => {
        const f = await getForm(page, formId);
        const qs = f.questions as Array<Record<string, any>>;
        const cats = qs.find((q) => q.is_section && q.title === "Cats");
        const dogs = qs.find((q) => q.is_section && q.title === "Dogs");
        const p = qs.find((q) => q.title === "Pet?");
        const a = qs.find((q) => q.title === "Cat age");
        const w = qs.find((q) => q.title === "Walks");
        return (
          !!cats &&
          !!dogs &&
          p?.go_to_section?.Cat === cats.id &&
          p?.go_to_section?.Dog === dogs.id &&
          cats.after_section === "__submit__" &&
          a?.validation?.op === "between" &&
          a?.validation?.value2 === "30" &&
          a?.validation?.error_text === "Cat ages are 1-30" &&
          w?.type === "multiple_choice_grid" &&
          w?.required === true &&
          JSON.stringify(w?.rows) === '["Mon","Tue"]' &&
          JSON.stringify(w?.options) === '["AM","PM"]'
        );
      }, { timeout: 15_000 })
      .toBe(true);

    await walks.getByPlaceholder("Question").click();
    await walks.scrollIntoViewIfNeeded();
    await walks.screenshot({ path: path.join(SHOT_DIR, "cc4-forms-editor-grid.png") });
  });

  test("respondent: Dog branch fills the grid; Cat section is skipped", async ({ page }) => {
    await page.goto(`/forms/d/${formId}/viewform`);
    await page.getByRole("radio", { name: "Dog" }).check();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("Dogs", { exact: true })).toBeVisible();
    await expect(page.getByText("Cat age")).toHaveCount(0);
    await page.getByRole("radio", { name: "Mon: AM" }).check();
    await page.getByTestId("submit-response").click();
    await expect(page.getByText("This question requires one response per row")).toBeVisible();
    await page.getByRole("radio", { name: "Tue: PM" }).check();
    await page.getByTestId("submit-response").click();
    await expect(page.getByText("Your response has been recorded.")).toBeVisible();

    const res = await page.request.get(`${BASE_URL}/api/v1/forms/${formId}/responses`);
    const [r] = (await res.json()).responses;
    const f = await getForm(page, formId);
    const id = (t: string) => f.questions.find((q: any) => q.title === t).id;
    const answers = JSON.parse(r.answers_json);
    expect(answers[id("Pet?")]).toBe("Dog");
    expect(answers[id("Walks")]).toEqual({ Mon: "AM", Tue: "PM" });
    expect(answers[id("Cat age")]).toBeUndefined();
  });

  test("respondent: Cat branch shows the validation error, then submits", async ({ page }) => {
    await page.goto(`/forms/d/${formId}/viewform`);
    await page.getByRole("radio", { name: "Cat" }).check();
    await page.getByRole("button", { name: "Next" }).click();

    const ageInput = page.getByRole("textbox", { name: "Cat age" });
    await ageInput.fill("45");
    await ageInput.blur();
    await expect(page.getByText("Cat ages are 1-30")).toBeVisible();
    // After the Cats section the form submits, so the button says Submit.
    await expect(page.getByTestId("submit-response")).toBeVisible();
    await page.screenshot({
      path: path.join(SHOT_DIR, "cc4-forms-validation-error.png"),
      fullPage: true,
    });
    await page.getByTestId("submit-response").click();
    await expect(page.getByText("Your response has been recorded.")).toHaveCount(0);

    await ageInput.fill("5");
    await expect(page.getByText("Cat ages are 1-30")).toHaveCount(0);
    await page.getByTestId("submit-response").click();
    await expect(page.getByText("Your response has been recorded.")).toBeVisible();
  });

  test("responses: summary counts skipped sections; server enforces validation", async ({ page }) => {
    const f = await getForm(page, formId);
    const id = (t: string) => f.questions.find((q: any) => q.title === t).id;

    const sum = await (await page.request.get(`${BASE_URL}/api/v1/forms/${formId}/summary`)).json();
    const qs = (qid: string) => sum.questions.find((q: any) => q.question_id === qid);
    expect(sum.response_count).toBe(2);
    expect(qs(id("Cat age")).skipped_count).toBe(1);
    expect(qs(id("Walks")).skipped_count).toBe(1);
    expect(qs(id("Walks")).grid_rows).toEqual([
      { row: "Mon", counts: { AM: 1 } },
      { row: "Tue", counts: { PM: 1 } },
    ]);

    // Individual view: the Dog response shows the Cat question as skipped.
    await page.goto(`/forms/d/${formId}/responses`);
    await expect(page.getByTestId(`grid-summary-${id("Walks")}`)).toBeVisible();
    await expect(page.getByText("1 skipped (section not reached)").first()).toBeVisible();
    await page.getByRole("tab", { name: "Individual" }).click();
    const answerOf = (t: string) => page.getByTestId(`response-answer-${id(t)}`);
    // Responses are listed newest first: the Cat response, then the Dog one.
    await expect(answerOf("Cat age")).toHaveText("5");
    await expect(answerOf("Walks")).toHaveText("(skipped: section not reached)");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(answerOf("Walks")).toHaveText("Mon: AM; Tue: PM");
    await expect(answerOf("Cat age")).toHaveText("(skipped: section not reached)");

    // The server re-checks validation and the grid rules.
    const post = (answers: Record<string, unknown>) =>
      page.request.post(`${BASE_URL}/api/v1/forms/${formId}/responses`, {
        data: { form_id: formId, answers_json: JSON.stringify(answers) },
      });
    const bad = await post({ [id("Pet?")]: "Cat", [id("Cat age")]: "99" });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain("Cat ages are 1-30");
    const badGrid = await post({ [id("Pet?")]: "Dog", [id("Walks")]: { Mon: "AM" } });
    expect(badGrid.status()).toBe(400);
    expect(await badGrid.text()).toContain("one response per row");
  });
});
