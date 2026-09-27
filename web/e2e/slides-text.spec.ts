import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, saveDeckData, trashDeck } from "./helpers";

// Slides M4: text editing inside a text box (browser-native contentEditable
// behaviour for caret moves and deletes, as the OnlyOffice shortcuts cases
// describe them) and the run model: selection-scoped formatting, bullets,
// links, find and replace, special characters.

const SHOT = process.env.GROWN_SLIDES_M4_SHOT;
const MAC = process.platform === "darwin";
// Platform editing keys (Chromium follows the OS conventions).
const K = {
  lineStart: MAC ? "Meta+ArrowLeft" : "Home",
  lineEnd: MAC ? "Meta+ArrowRight" : "End",
  docStart: MAC ? "Meta+ArrowUp" : "Control+Home",
  docEnd: MAC ? "Meta+ArrowDown" : "Control+End",
  wordLeft: MAC ? "Alt+ArrowLeft" : "Control+ArrowLeft",
  wordRight: MAC ? "Alt+ArrowRight" : "Control+ArrowRight",
  wordBack: MAC ? "Alt+Backspace" : "Control+Backspace",
  wordDelete: MAC ? "Alt+Delete" : "Control+Delete",
};

type El = Record<string, unknown> & { id: string };

const textBox = (id: string, text: string, extra: Record<string, unknown> = {}): El => ({
  id,
  type: "text",
  x: 100,
  y: 80,
  w: 600,
  h: 300,
  text,
  fontSize: 24,
  fontFamily: "Arial",
  color: "#202124",
  align: "left",
  valign: "top",
  ...extra,
});

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

async function openWith(page: Page, name: string, elements: El[], extraSlides = 0) {
  const id = await createDeck(page.request, name);
  const slides = [{ id: "s1", background: "#ffffff", elements, notes: "" }];
  for (let i = 0; i < extraSlides; i++) slides.push({ id: `s${i + 2}`, background: "#ffffff", elements: [], notes: "" });
  await saveDeckData(page.request, id, { slides });
  await page.goto(`${BASE_URL}/slides/d/${id}`);
  await expect(page.getByTestId("slide-canvas").locator(`[data-el-id="${elements[0]?.id ?? "x"}"]`)).toBeVisible();
  return id;
}

/** Double-click a text box into edit mode; resolves to the editor. */
async function edit(page: Page, elId: string) {
  await page.getByTestId("slide-canvas").locator(`[data-el-id="${elId}"]`).dblclick();
  const ed = page.locator("[data-text-editor]");
  await expect(ed).toBeFocused();
  return ed;
}

/** Leave the text box (Esc commits), save now, and read the element back. */
async function commit(page: Page, id: string, elId = "t") {
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-text-editor]")).toHaveCount(0);
  const saved = waitForSave(page, id);
  await page.keyboard.press("ControlOrMeta+s");
  await saved;
  const deck = await getDeckData(page.request, id);
  return deck!.slides[0].elements.find((e) => e.id === elId);
}

const selected = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test.describe("slides text (M4)", () => {
  test("oo:slide/shortcuts/shortcuts.js#Check add various characters", async ({ page }) => {
    const id = await openWith(page, "e2e text chars", [textBox("t", "")]);
    try {
      await edit(page, "t");
      await page.keyboard.press("Control+Shift+Space");
      await page.keyboard.press("Control+Alt+KeyE");
      await page.keyboard.press("Control+Alt+Minus");
      await page.keyboard.press("Space");
      const el = await commit(page, id);
      expect(el.text).toBe(" €– ");
    } finally {
      await trashDeck(page.request, id);
    }
  });

  // Caret moves are the browser's own; checked through the selections the
  // Shift variants make (lines wrap after "Hello World Hello ").
  test("oo:slide/shortcuts/shortcuts.js#Check actions with text movements", async ({ page }) => {
    const text = Array.from({ length: 9 }, () => "Hello World Hello ").join("").trimEnd();
    const id = await openWith(page, "e2e text moves", [
      // Monospace, 20 px: 12 px per character, so 17–22 characters fit a line.
      textBox("t", text, { fontFamily: "Courier New, monospace", fontSize: 20, w: 248, h: 420, y: 40 }),
    ]);
    try {
      await edit(page, "t");
      await page.keyboard.press(K.docStart);
      await page.keyboard.press(`Shift+${K.lineEnd}`);
      expect((await selected(page)).trimEnd()).toBe("Hello World Hello");
      await page.keyboard.press(K.docStart);
      await page.keyboard.press(`Shift+${K.wordRight}`);
      expect((await selected(page)).trim()).toBe("Hello");
      await page.keyboard.press(`Shift+${K.wordRight}`);
      expect((await selected(page)).trim()).toBe("Hello World");
      await page.keyboard.press(`Shift+${K.wordLeft}`);
      expect((await selected(page)).trim()).toBe("Hello");
      await page.keyboard.press(K.docStart);
      await page.keyboard.press("Shift+ArrowDown");
      expect(await selected(page)).toBe("Hello World Hello ");
      await page.keyboard.press(K.docEnd);
      await page.keyboard.press("Shift+ArrowLeft");
      expect(await selected(page)).toBe("o");
      await page.keyboard.press(K.docEnd);
      await page.keyboard.press(`Shift+${K.wordLeft}`);
      expect(await selected(page)).toBe("Hello");
      await page.keyboard.press(`Shift+${K.docStart}`);
      expect(await selected(page)).toBe(text);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("oo:slide/shortcuts/shortcuts.js#Check remove parts of text", async ({ page }) => {
    const id = await openWith(page, "e2e text delete", [textBox("t", "Hello Hello Hello Hello Hello Hello Hello")]);
    try {
      const ed = await edit(page, "t");
      const txt = async () => ((await ed.textContent()) ?? "").replace(/ /g, " ");
      await page.keyboard.press(K.docEnd);
      await page.keyboard.press("Backspace");
      expect(await txt()).toBe("Hello Hello Hello Hello Hello Hello Hell");
      await page.keyboard.press(K.wordBack);
      expect(await txt()).toBe("Hello Hello Hello Hello Hello Hello ");
      await page.keyboard.press(K.wordBack);
      expect(await txt()).toBe("Hello Hello Hello Hello Hello ");
      await page.keyboard.press(K.docStart);
      await page.keyboard.press("Delete");
      expect(await txt()).toBe("ello Hello Hello Hello Hello ");
      // Ctrl+Delete removes the word (Windows/Linux also its trailing space).
      await page.keyboard.press(K.wordDelete);
      expect((await txt()).trimStart()).toBe("Hello Hello Hello Hello ");
      const el = await commit(page, id);
      expect(el.text.trimStart()).toBe("Hello Hello Hello Hello ");
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("oo:slide/shortcuts/shortcuts.js#Check add break line", async ({ page }) => {
    const id = await openWith(page, "e2e text break", [textBox("t", "Hello Hello")]);
    try {
      await edit(page, "t");
      await page.keyboard.press(K.docStart);
      for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+Enter");
      const el = await commit(page, id);
      // One paragraph, two lines.
      expect(el.text).toBe("Hello \vHello");
      expect(el.text.split("\n")).toHaveLength(1);
      const box = page.getByTestId("slide-canvas").locator('[data-el-id="t"]');
      await expect(box.locator("[data-para]")).toHaveCount(1);
      await expect(box.locator("[data-para] br")).toHaveCount(1);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("oo:slide/shortcuts/shortcuts.js#Check add new paragraph", async ({ page }) => {
    const id = await openWith(page, "e2e text para", [textBox("t", "")]);
    try {
      await edit(page, "t");
      await page.keyboard.type("one");
      await page.keyboard.press("Enter");
      await page.keyboard.type("two");
      const el = await commit(page, id);
      expect(el.text.split("\n")).toEqual(["one", "two"]);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("oo:slide/shortcuts/shortcuts.js#Check add tab symbol", async ({ page }) => {
    const id = await openWith(page, "e2e text tab", [textBox("t", "")]);
    try {
      await edit(page, "t");
      await page.keyboard.press("Tab");
      const el = await commit(page, id);
      expect(el.text).toBe("\t");
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("oo:slide/shortcuts/shortcuts.js#Check select all", async ({ page }) => {
    const id = await openWith(page, "e2e text select all", [textBox("t", "Hello"), textBox("u", "Other", { y: 400, h: 60 })]);
    try {
      await edit(page, "t");
      await page.keyboard.press("ControlOrMeta+a");
      // Only the text box's content, not the page or the other boxes.
      expect(await selected(page)).toBe("Hello");
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("selection formatting makes runs that persist and render", async ({ page }) => {
    const id = await openWith(page, "e2e text runs", [textBox("t", "Hello world")]);
    try {
      await edit(page, "t");
      await page.keyboard.press(K.docEnd);
      await page.keyboard.press(`Shift+${K.wordLeft}`);
      expect(await selected(page)).toBe("world");
      await page.keyboard.press("ControlOrMeta+b");
      await page.keyboard.press("ControlOrMeta+.");
      // Still editing, same selection.
      expect(await selected(page)).toBe("world");
      await page.keyboard.press("ControlOrMeta+]");
      const el = await commit(page, id);
      expect(el.text).toBe("Hello world");
      expect(el.bold).toBeFalsy();
      expect(el.runs).toEqual([{ text: "Hello " }, { text: "world", bold: true, baseline: "super", fontSize: 26 }]);

      await page.reload();
      const box = page.getByTestId("slide-canvas").locator('[data-el-id="t"]');
      const bold = box.locator("span", { hasText: /^world$/ }).first();
      await expect(bold).toHaveCSS("font-weight", "700");
      await expect(bold).toHaveCSS("vertical-align", "super");

      // Selected (not editing): Ctrl+B applies to the whole box.
      await box.click();
      const saved = waitForSave(page, id);
      await page.keyboard.press("ControlOrMeta+b");
      await saved;
      const deck = await getDeckData(page.request, id);
      const t = deck!.slides[0].elements[0];
      expect(t.bold).toBe(true);
      expect(t.runs).toEqual([{ text: "Hello " }, { text: "world", baseline: "super", fontSize: 26 }]);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("bullets with levels, paint format and clear formatting", async ({ page }) => {
    const id = await openWith(page, "e2e text bullets", [textBox("t", "")]);
    try {
      await edit(page, "t");
      await page.keyboard.press("ControlOrMeta+Shift+L");
      await page.keyboard.type("Top");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Nested");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Deeper");
      let el = await commit(page, id);
      expect(el.list).toBe("bullet");
      expect(el.text).toBe("Top\nNested\nDeeper");
      expect(el.paras).toEqual([{}, { level: 1 }, { level: 2 }]);
      const box = page.getByTestId("slide-canvas").locator('[data-el-id="t"]');
      await expect(box.locator("[data-marker]")).toHaveText(["•", "◦", "▪"]);

      // Paint format: copy "Top" in bold, paste onto "Deeper"; then clear it.
      await edit(page, "t");
      await page.keyboard.press(K.docStart);
      await page.keyboard.press(`Shift+${K.lineEnd}`);
      await page.keyboard.press("ControlOrMeta+b");
      await page.keyboard.press("ControlOrMeta+Shift+C");
      await page.keyboard.press(K.docEnd);
      await page.keyboard.press(`Shift+${K.lineStart}`);
      await page.keyboard.press("ControlOrMeta+Shift+V");
      el = await commit(page, id);
      expect(el.runs).toEqual([
        { text: "Top\n", bold: true },
        { text: "Nested\n" },
        { text: "Deeper", bold: true },
      ]);
      await edit(page, "t");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("ControlOrMeta+Space");
      el = await commit(page, id);
      expect(el.runs).toBeUndefined();
      expect(el.bold).toBeFalsy();
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("hyperlink dialog: web address and slide target; Ctrl+click follows", async ({ page }) => {
    const id = await openWith(page, "e2e text links", [textBox("t", "Docs and the end")], 2);
    try {
      await edit(page, "t");
      await page.keyboard.press(K.docStart);
      await page.keyboard.press(`Shift+${K.wordRight}`);
      await page.keyboard.press("ControlOrMeta+k");
      const dlg = page.getByRole("dialog", { name: "Hyperlink" });
      await expect(dlg).toBeVisible();
      await dlg.getByLabel("Link address").fill("javascript:alert(1)");
      await expect(dlg.getByTestId("link-kind")).toHaveText("Not a valid link");
      await expect(dlg.getByRole("button", { name: "Apply" })).toBeDisabled();
      await dlg.getByLabel("Link address").fill("example.com/docs");
      await expect(dlg.getByTestId("link-kind")).toHaveText("Web address");
      await dlg.getByRole("button", { name: "Apply" }).click();
      await expect(page.locator("[data-text-editor]")).toBeFocused();

      // "end" → the last slide.
      await page.keyboard.press(K.docEnd);
      await page.keyboard.press(`Shift+${K.wordLeft}`);
      await page.keyboard.press("ControlOrMeta+k");
      await dlg.getByRole("radio", { name: "Slide in this presentation" }).check();
      await dlg.getByRole("combobox", { name: "Link to slide" }).click();
      await page.getByRole("option", { name: "Last slide" }).click();
      await dlg.getByRole("button", { name: "Apply" }).click();
      await expect(page.locator("[data-text-editor]")).toBeFocused();
      const el = await commit(page, id);
      expect(el.text).toBe("Docs and the end");
      expect(el.runs).toEqual([
        { text: "Docs", url: "https://example.com/docs" },
        { text: " and the " },
        { text: "end", url: "#slide:last" },
      ]);

      // Ctrl/Cmd+click on the slide link jumps to the last slide.
      await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
      await page.getByTestId("slide-canvas").locator('[data-link="#slide:last"]').click({ modifiers: ["ControlOrMeta"] });
      await expect(page.getByTestId("slide-canvas").locator('[data-el-id="t"]')).toHaveCount(0);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("find and replace across slides and notes; special characters", async ({ page }) => {
    const id = await createDeck(page.request, "e2e text find");
    try {
      await saveDeckData(page.request, id, {
        slides: [
          { id: "s1", background: "#ffffff", notes: "cat notes", elements: [textBox("t", "The cat sat")] },
          { id: "s2", background: "#ffffff", notes: "", elements: [textBox("u", "Another cat")] },
        ],
      });
      await page.goto(`${BASE_URL}/slides/d/${id}`);
      await expect(page.getByTestId("slide-canvas").locator('[data-el-id="t"]')).toBeVisible();
      await page.keyboard.press("ControlOrMeta+h");
      const panel = page.getByRole("dialog", { name: "Find and replace" });
      await panel.getByRole("textbox", { name: "Find", exact: true }).fill("cat");
      await expect(panel.getByTestId("find-count")).toHaveText("1 of 3");
      await panel.getByRole("button", { name: "Next" }).click();
      await panel.getByLabel("Replace with").fill("dog");
      const saved = waitForSave(page, id);
      await panel.getByRole("button", { name: "Replace all" }).click();
      await expect(panel.getByTestId("find-msg")).toHaveText("Replaced 3 occurrences");
      await saved;
      const deck = (await getDeckData(page.request, id)) as unknown as {
        slides: { notes: string; elements: El[] }[];
      };
      expect(deck.slides[0].elements[0].text).toBe("The dog sat");
      expect(deck.slides[0].notes).toBe("dog notes");
      expect(deck.slides[1].elements[0].text).toBe("Another dog");
      await panel.getByRole("button", { name: "Close find and replace" }).click();

      // Insert ▸ Special characters into the caret position.
      await page.getByTestId("slide-thumb").first().click();
      await edit(page, "t");
      await page.keyboard.press(K.docEnd);
      await page.getByRole("button", { name: "Insert", exact: true }).click();
      await page.getByRole("menuitem", { name: "Special characters…" }).click();
      const dlg = page.getByRole("dialog", { name: "Special characters" });
      await dlg.getByLabel("Search characters").fill("euro");
      await dlg.getByRole("button", { name: "Insert euro sign" }).click();
      await dlg.getByRole("button", { name: "Close" }).click();
      await expect(page.locator("[data-text-editor]")).toBeFocused();
      const el = await commit(page, id);
      expect(el.text).toBe("The dog sat€");
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("renders mixed runs, multi-level bullets and a link (screenshot)", async ({ page }) => {
    const id = await openWith(page, "e2e text render", [
      {
        ...textBox("t", "Quarterly results beat the plan\nRevenue up 12%\nEurope and Asia\nNew markets\nSee the appendix for details", {
          x: 80,
          y: 60,
          w: 800,
          h: 420,
          fontSize: 28,
          list: "bullet",
        }),
        paras: [{}, { level: 1 }, { level: 2 }, { level: 1 }],
        runs: [
          { text: "Quarterly " },
          { text: "results", bold: true, color: "#d93025" },
          { text: " beat the " },
          { text: "plan", italic: true, underline: true },
          { text: "\nRevenue up " },
          { text: "12%", bold: true, fontSize: 36, color: "#188038" },
          { text: "\nEurope and Asia\nNew " },
          { text: "markets", strike: true },
          { text: "\nSee the " },
          { text: "appendix", url: "#slide:last" },
          { text: " for details" },
        ],
      },
      textBox("f", "E = mc2 and H2O", { y: 480, h: 50, fontSize: 24, runs: [{ text: "E = mc" }, { text: "2", baseline: "super" }, { text: " and H" }, { text: "2", baseline: "sub" }, { text: "O" }] }),
    ], 1);
    try {
      const box = page.getByTestId("slide-canvas").locator('[data-el-id="t"]');
      await expect(box.locator("[data-marker]")).toHaveText(["•", "◦", "▪", "◦", "•"]);
      await expect(box.locator("span", { hasText: /^results$/ }).first()).toHaveCSS("color", "rgb(217, 48, 37)");
      await expect(box.locator('[data-link="#slide:last"]')).toHaveCSS("text-decoration-line", "underline");
      if (SHOT) await page.getByTestId("slide-canvas").screenshot({ path: SHOT });
    } finally {
      await trashDeck(page.request, id);
    }
  });
});
