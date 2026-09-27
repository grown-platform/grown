import { test, expect, type Page } from "@playwright/test";
import { BASE_URL } from "./helpers";

// Forms "Limit to 1 response": the respondent submits once, a reload shows
// "You've already responded" instead of the questions, the server answers a
// second submission with 409, and a stale tab that submits later lands on the
// "already responded" page rather than an error.

const settings = (limit: boolean) => ({
  collect_email: false,
  limit_one_response: limit,
  show_progress_bar: false,
  shuffle_questions: false,
  confirmation_message: "",
  is_quiz: false,
});

async function createLimitedForm(page: Page, title: string): Promise<string> {
  const res = await page.request.post(`${BASE_URL}/api/v1/forms`, { data: { title } });
  expect(res.ok()).toBeTruthy();
  const id = (await res.json()).id as string;
  const upd = await page.request.patch(`${BASE_URL}/api/v1/forms/${id}`, {
    data: {
      id,
      title,
      questions: [{ id: "q1", type: "short_answer", title: "Your name" }],
      settings: settings(true),
      accepting: true,
    },
  });
  expect(upd.ok()).toBeTruthy();
  expect((await upd.json()).settings.limit_one_response).toBe(true);
  return id;
}

test.describe("forms: limit to one response", () => {
  const created: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of created)
      await request.delete(`${BASE_URL}/api/v1/forms/${id}`).catch(() => {});
  });

  test("submit, reload, see already responded; server refuses a second response", async ({ page }) => {
    const id = await createLimitedForm(page, "e2e one response");
    created.push(id);

    await page.goto(`/forms/d/${id}/viewform`);
    await page.getByRole("textbox").first().fill("Ada");
    await page.getByTestId("submit-response").click();
    await expect(page.getByText("Your response has been recorded.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit another response" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("form-already-responded")).toBeVisible();
    await expect(page.getByText("You've already responded")).toBeVisible();
    await expect(page.getByTestId("submit-response")).toHaveCount(0);

    const mine = await page.request.get(`${BASE_URL}/api/v1/forms/${id}/my-response`);
    expect(mine.ok()).toBeTruthy();
    expect((await mine.json()).responded).toBe(true);

    const again = await page.request.post(`${BASE_URL}/api/v1/forms/${id}/responses`, {
      data: { form_id: id, answers_json: JSON.stringify({ q1: "Ada again" }) },
    });
    expect(again.status()).toBe(409);

    const list = await page.request.get(`${BASE_URL}/api/v1/forms/${id}/responses`);
    expect((await list.json()).responses).toHaveLength(1);
  });

  test("a stale tab that submits second gets the already-responded page", async ({ page, context }) => {
    const id = await createLimitedForm(page, "e2e one response stale tab");
    created.push(id);

    // Both tabs load the form before either submits.
    const stale = await context.newPage();
    await stale.goto(`/forms/d/${id}/viewform`);
    await stale.getByRole("textbox").first().fill("Tab B");
    await page.goto(`/forms/d/${id}/viewform`);
    await page.getByRole("textbox").first().fill("Tab A");

    await page.getByTestId("submit-response").click();
    await expect(page.getByText("Your response has been recorded.")).toBeVisible();

    await stale.getByTestId("submit-response").click();
    await expect(stale.getByTestId("form-already-responded")).toBeVisible();
  });
});
