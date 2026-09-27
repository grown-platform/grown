import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, saveDeckData, trashDeck } from "./helpers";

// Slides M8/M9: set a transition and animations in the Motion panel (two
// effects chained with After previous, plus an emphasis on the next click),
// present from the beginning, step through with the keyboard (animation
// order, number + Enter, Home/End, black screen, hidden slide skipped), and
// open the presenter window (synced over a BroadcastChannel).
// GROWN_SLIDES_M8_SHOT=<prefix> saves screenshots of the animation pane and
// the presenter view.

const SHOT = process.env.GROWN_SLIDES_M8_SHOT;

type Deck = {
  slides: Array<{
    id: string;
    transition?: string;
    transitionDir?: string;
    transitionDur?: number;
    anims?: Array<{ el: string; cls: string; kind: string; start: string; dir?: string }>;
  }>;
};

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

const shape = (id: string, x: number, fill: string) => ({ id, type: "rect", name: id, x, y: 180, w: 160, h: 120, fill, stroke: "none", strokeWidth: 0 });
const title = (id: string, text: string) => ({ id, type: "text", text, x: 60, y: 40, w: 840, h: 80, fontSize: 36, color: "#202124" });

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("transitions, animations, slideshow keys and presenter window", async ({ page, context }) => {
  const id = await createDeck(page.request, "e2e slides show");
  try {
    await saveDeckData(page.request, id, {
      slides: [
        {
          id: "s1",
          background: "#ffffff",
          notes: "Welcome everyone. Point at the blue box first.",
          elements: [title("t1", "Motion demo"), shape("boxA", 80, "#4285f4"), shape("boxB", 400, "#34a853"), shape("boxC", 720, "#ea4335")],
        },
        { id: "s2", background: "#fef7e0", notes: "Second slide notes.", elements: [title("t2", "Second slide")] },
        { id: "s3", background: "#ffffff", hidden: true, elements: [title("t3", "Hidden slide")] },
        { id: "s4", background: "#e8f0fe", elements: [title("t4", "Last slide")] },
      ],
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas.getByText("Motion demo")).toBeVisible();

    // Motion panel: transition Push from bottom, 0.6 s, applied to all.
    await page.getByRole("button", { name: "Slide", exact: true }).click();
    await page.getByRole("menuitem", { name: "Transition…" }).click();
    const panel = page.getByTestId("motion-panel");
    await expect(panel).toBeVisible();
    await pick(page, "Slide transition", "Push");
    await pick(page, "Transition option", "From bottom");
    const dur = panel.getByRole("spinbutton", { name: "Transition duration" });
    await dur.fill("0.6");
    await dur.press("Enter");
    await panel.getByRole("button", { name: "Apply to all slides" }).click();

    // Box A: Fade in (on click). Box B: Fly in from left, After previous.
    await canvas.locator('[data-el-id="boxA"]').click();
    await panel.getByRole("button", { name: "Add animation" }).click();
    await page.getByRole("menuitem", { name: "Fade" }).first().click();
    await canvas.locator('[data-el-id="boxB"]').click();
    await panel.getByRole("button", { name: "Add animation" }).click();
    await page.getByRole("menuitem", { name: "Fly in" }).click();
    await pick(page, "Direction", "From left");
    await pick(page, "Start", "After previous");
    // Box C: Spin (emphasis) on the next click.
    await canvas.locator('[data-el-id="boxC"]').click();
    await panel.getByRole("button", { name: "Add animation" }).click();
    const saved = waitForSave(page, id);
    await page.getByRole("menuitem", { name: "Spin" }).click();
    await saved;

    const effects = page.getByTestId("anim-effect");
    await expect(effects).toHaveCount(3);
    await expect(effects.nth(0)).toContainText("Fade");
    await expect(effects.nth(1)).toContainText("Fly in from left");
    await expect(effects.nth(2)).toContainText("Spin");

    // Reorder: move Spin earlier then back (the pane's order buttons).
    await effects.nth(2).getByRole("button", { name: "Move earlier" }).click();
    await expect(effects.nth(1)).toContainText("Spin");
    await effects.nth(1).getByRole("button", { name: "Move later" }).click();
    await expect(effects.nth(2)).toContainText("Spin");
    await effects.nth(1).click();
    if (SHOT) await page.screenshot({ path: `${SHOT}-animation-pane.png` });

    await expect
      .poll(async () => {
        const d = (await getDeckData(page.request, id)) as unknown as Deck;
        return JSON.stringify([
          d.slides.map((s) => [s.transition, s.transitionDir, s.transitionDur]),
          (d.slides[0].anims ?? []).map((a) => [a.el, a.cls, a.kind, a.start, a.dir ?? ""]),
        ]);
      })
      .toBe(
        JSON.stringify([
          Array(4).fill(["push", "u", 600]),
          [
            ["boxA", "entr", "fade", "click", ""],
            ["boxB", "entr", "fly", "after", "l"],
            ["boxC", "emph", "spin", "click", ""],
          ],
        ]),
      );

    // Present from the beginning.
    await page.getByRole("button", { name: "Slideshow options" }).click();
    await page.getByRole("menuitem", { name: "Present from beginning" }).click();
    const show = page.getByTestId("slideshow");
    await expect(show).toHaveAttribute("data-slide", "0");
    await expect(show).toHaveAttribute("data-step", "0");
    // Hidden slide skipped: 3 slides in the show.
    await expect(show.getByText("1 / 3 · Esc to exit")).toBeVisible();
    const el = (elId: string) => show.getByTestId("show-slide").locator(`[data-view-el="${elId}"]`);
    // Entrances are hidden before their click.
    const opacity = (elId: string) => el(elId).evaluate((n) => getComputedStyle(n).opacity);
    await expect.poll(() => opacity("boxA")).toBe("0");
    await expect.poll(() => opacity("boxB")).toBe("0");

    // Click 1: A fades in at 0 ms, B flies in after it (delay = A's 500 ms).
    await page.keyboard.press("ArrowRight");
    await expect(show).toHaveAttribute("data-step", "1");
    const anim = (elId: string) => el(elId).evaluate((n) => [getComputedStyle(n).animationName, getComputedStyle(n).animationDelay]);
    expect(await anim("boxA")).toEqual(["anFade", "0s"]);
    expect(await anim("boxB")).toEqual(["anFlyL", "0.5s"]);
    await expect.poll(() => opacity("boxB"), { timeout: 5000 }).toBe("1");
    // Click 2 (N): the spin.
    await page.keyboard.press("n");
    await expect(show).toHaveAttribute("data-step", "2");
    expect((await anim("boxC"))[0]).toBe("anSpin");
    // Next: slide 2 with the push transition.
    await page.keyboard.press(" ");
    await expect(show).toHaveAttribute("data-slide", "1");
    if (SHOT) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOT}-transition.png` });
    }
    await expect(show.getByText("2 / 3 · Esc to exit")).toBeVisible();
    // Black screen toggles.
    await page.keyboard.press("b");
    await expect(page.getByTestId("show-blank")).toHaveAttribute("data-blank", "black");
    await page.keyboard.press("b");
    await expect(page.getByTestId("show-blank")).toHaveCount(0);
    // End, Home, number + Enter, prev (P) rebuilds the first slide fully.
    await page.keyboard.press("End");
    await expect(show).toHaveAttribute("data-slide", "2");
    await expect(show.getByText("Last slide")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(show).toHaveAttribute("data-slide", "0");
    await page.keyboard.press("2");
    await page.keyboard.press("Enter");
    await expect(show).toHaveAttribute("data-slide", "1");
    await page.keyboard.press("p");
    await expect(show).toHaveAttribute("data-slide", "0");
    await expect(show).toHaveAttribute("data-step", "2");

    // Pen ink (Ctrl+P), erased with E; the laser pointer (Ctrl+L).
    await page.keyboard.press("ControlOrMeta+p");
    const stage = await show.getByTestId("show-slide").boundingBox();
    await page.mouse.move(stage!.x + 200, stage!.y + 200);
    await page.mouse.down();
    await page.mouse.move(stage!.x + 400, stage!.y + 260, { steps: 6 });
    await page.mouse.up();
    await expect(show.locator("polyline")).toHaveCount(1);
    await expect(show).toHaveAttribute("data-slide", "0"); // drawing does not advance
    if (SHOT) await page.screenshot({ path: `${SHOT}-ink.png` });
    await page.keyboard.press("e");
    await expect(show.locator("polyline")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+l");
    await page.mouse.move(stage!.x + 300, stage!.y + 300);
    await expect(page.getByTestId("laser")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+l");

    // Presenter window: current + next slide, notes, timer, counter.
    const popupP = context.waitForEvent("page");
    await show.getByRole("button", { name: "Presenter window" }).click();
    const popup = await popupP;
    await popup.setViewportSize({ width: 1200, height: 760 });
    await expect(popup.getByTestId("presenter-view")).toBeVisible();
    await expect(popup.getByTestId("presenter-counter")).toHaveText("Slide 1 / 3");
    await expect(popup.getByTestId("presenter-notes")).toContainText("Point at the blue box first.");
    await expect(popup.getByTestId("presenter-timer")).toHaveText(/^\d\d:\d\d$/);
    await expect(popup.getByTestId("presenter-next").getByText("Second slide")).toBeVisible();
    // Navigation from the presenter window drives the show.
    await popup.getByRole("button", { name: "Next", exact: true }).click();
    await expect(show).toHaveAttribute("data-slide", "1");
    await expect(popup.getByTestId("presenter-counter")).toHaveText("Slide 2 / 3");
    await expect(popup.getByTestId("presenter-notes")).toContainText("Second slide notes.");
    await popup.keyboard.press("ArrowRight");
    await expect(show).toHaveAttribute("data-slide", "2");
    await popup.keyboard.press("ArrowLeft");
    await expect(show).toHaveAttribute("data-slide", "1");
    if (SHOT) await popup.screenshot({ path: `${SHOT}-presenter.png` });

    // Esc ends the show and closes the presenter window.
    const closed = popup.waitForEvent("close");
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
    await closed;
    await expect(page.getByTestId("slide-thumb").nth(1)).toBeVisible();

    // Single-window presenter view (S) as the fallback.
    await page.getByRole("button", { name: "Present", exact: true }).click();
    await page.keyboard.press("s");
    await expect(page.getByTestId("presenter-view")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presenter-view")).toHaveCount(0);
  } finally {
    await trashDeck(page.request, id);
  }
});
