import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M7: pictures, shapes and charts in the real app. Uploads a picture
// (it goes to the document's asset store, not a data: URL), wraps it
// square so the paragraph flows beside it, resizes it from a corner with
// the aspect ratio locked, crops it and gives it alt text from the image
// settings panel; inserts a shape with text and a chart; reloads (the Yjs
// log kept every attribute), then downloads the document as .docx and
// imports the download.
//
// Set DOCS_M7_SCREENSHOT=<path> to save a screenshot of the page.

const editor = (page: Page) => page.locator(".ProseMirror").first();
const picture = (page: Page) => editor(page).locator('.doc-obj[data-kind="picture"]').first();

const LOREM =
  "Grown documents now hold real pictures. This paragraph is long enough to flow beside a square-wrapped picture: " +
  "its lines start to the right of the image while they are level with it, and return to the full column width " +
  "once they pass its bottom edge. Word calls this square wrapping, and the picture is anchored to this paragraph. " +
  "More words keep the paragraph going so that several lines sit next to the picture and a few more run below it, " +
  "which is what a reader of the page expects to see when text wraps around an image in a word processor.";

async function menu(page: Page, top: string, item: string | RegExp) {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).first().click();
}

/** A 240×160 PNG drawn in the page (a gradient with a circle). */
async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 160;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 240, 160);
    grad.addColorStop(0, "#1a73e8");
    grad.addColorStop(1, "#34a853");
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 160);
    g.fillStyle = "#fbbc04";
    g.beginPath();
    g.arc(120, 80, 50, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

async function importFromHome(page: Page, name: string, buffer: Buffer): Promise<string> {
  await page.goto(`${BASE_URL}/`);
  await page.getByTestId("tile-docs").click();
  await expect(page.getByTestId("docs-import")).toBeVisible();
  await page.getByTestId("docs-import-input").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  });
  await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
  return page.url().split("/").pop()!;
}

/** Does text of the picture's paragraph sit beside the picture (to its
 *  right, level with it) and also below it at the full column width? */
async function wrapGeometry(page: Page) {
  return page.evaluate(() => {
    const obj = document.querySelector('.ProseMirror .doc-obj[data-kind="picture"]') as HTMLElement;
    const p = obj.closest("p")!;
    const o = obj.getBoundingClientRect();
    const col = (document.querySelector(".ProseMirror") as HTMLElement).getBoundingClientRect();
    const range = document.createRange();
    let beside = 0;
    let below = 0;
    let minLeftBelow = Infinity;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 1) continue;
        if (r.top >= o.top - 1 && r.bottom <= o.bottom + 1 && r.left >= o.right - 1) beside++;
        if (r.top >= o.bottom) {
          below++;
          minLeftBelow = Math.min(minLeftBelow, r.left);
        }
      }
    }
    return { beside, below, belowAtColumnStart: Math.abs(minLeftBelow - col.left) < 20, objLeft: o.left - col.left, objWidth: o.width, objHeight: o.height };
  });
}

test.describe.serial("docs images, shapes and charts (M7)", () => {
  test("upload, square wrap, resize, crop, alt text, shape, chart; reload and .docx round trip", async ({ page }) => {
    test.setTimeout(120_000);
    const ids: string[] = [];
    try {
      const id = await createDoc(page.request, "e2e images");
      ids.push(id);
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("Pictures, shapes and charts");
      await page.keyboard.press("Enter");
      await page.keyboard.type(LOREM, { delay: 0 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("A shape with text and a chart:");
      // Caret to the start of the long paragraph: the picture's anchor.
      await editor(page).locator("p").nth(1).click({ position: { x: 2, y: 8 } });

      // Insert ▸ Image from computer: uploaded to the asset store.
      const png = await makePng(page);
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menu(page, "Insert", "Image from computer…")]);
      await chooser.setFiles({ name: "chart.png", mimeType: "image/png", buffer: png });
      const img = picture(page).locator("img");
      await expect(img).toHaveAttribute("src", new RegExp(`^/api/v1/docs/d/${id}/assets/[0-9a-f]{64}$`), { timeout: 15_000 });
      const src = (await img.getAttribute("src"))!;
      const asset = await page.request.get(`${BASE_URL}${src}`);
      expect(asset.status()).toBe(200);
      expect(asset.headers()["content-type"]).toBe("image/png");
      expect(asset.headers()["x-content-type-options"]).toBe("nosniff");
      await expect(picture(page)).toHaveAttribute("data-wrap", "inline");

      // Image settings: square wrapping.
      await menu(page, "Format", "Image settings…");
      const panel = page.getByTestId("object-settings");
      await expect(panel).toBeVisible();
      await panel.getByTestId("obj-wrap").click();
      await page.getByRole("option", { name: "Square" }).click();
      await expect(picture(page)).toHaveAttribute("data-wrap", "square");
      await expect(picture(page)).toHaveCSS("float", "left");

      // Resize from the bottom-right corner: the aspect ratio is locked.
      await picture(page).click();
      const handle = picture(page).locator('.doc-obj-h[data-h="se"]');
      await expect(handle).toBeVisible();
      const hb = (await handle.boundingBox())!;
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 4, { steps: 6 });
      await page.mouse.up();
      await expect(panel.getByTestId("obj-width")).toHaveValue("270");
      await expect(panel.getByTestId("obj-height")).toHaveValue("180");

      // Crop 10% off the left: the frame narrows, the picture keeps its scale.
      await panel.getByTestId("obj-crop-l").fill("10");
      await panel.getByTestId("obj-crop-l").press("Enter");
      await expect(panel.getByTestId("obj-width")).toHaveValue("243");
      const imgLeft = await img.evaluate((el) => parseFloat((el as HTMLElement).style.left));
      expect(imgLeft).toBeCloseTo(-27, 0);

      // Alt text.
      await panel.getByTestId("obj-alt").fill("Blue and green gradient with a yellow circle");
      await panel.getByTestId("obj-alt").blur();
      await expect(img).toHaveAttribute("alt", "Blue and green gradient with a yellow circle");

      // The paragraph's text flows beside the picture and returns below it.
      const geo = await wrapGeometry(page);
      expect(geo.beside).toBeGreaterThan(2);
      expect(geo.below).toBeGreaterThan(0);
      expect(geo.belowAtColumnStart).toBe(true);

      // Insert ▸ Shape: a rounded rectangle with text, in the last paragraph.
      const lastP = editor(page).locator("p").last();
      const lb = (await lastP.boundingBox())!;
      await lastP.click({ position: { x: lb.width - 4, y: 8 } });
      await page.keyboard.press("End");
      await menu(page, "Insert", "Shape…");
      await page.getByTestId("shape-gallery").locator('[data-preset="roundRect"]').first().click();
      const shape = editor(page).locator('.doc-obj[data-type="shape"]').first();
      await expect(shape).toBeVisible();
      await expect(shape.locator("svg path").first()).toBeVisible();
      await shape.locator(".doc-shape-inner").click();
      await page.keyboard.type("Shape text");
      await expect(shape.locator(".doc-shape-inner")).toHaveText("Shape text");

      // Insert ▸ Chart with its sample data.
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await menu(page, "Insert", "Chart…");
      await expect(page.getByTestId("chart-grid")).toBeVisible();
      await page.getByRole("button", { name: "Insert", exact: true }).click();
      const chart = editor(page).locator('.doc-obj[data-kind="chart"]').first();
      await expect(chart.locator(".doc-chart-root svg")).toBeVisible({ timeout: 10_000 });
      await expect(chart.locator(".doc-chart-root svg rect").nth(3)).toBeVisible();

      await page.getByRole("button", { name: "Close object settings" }).click().catch(() => {});
      await page.keyboard.press("Escape");
      const shot = process.env.DOCS_M7_SCREENSHOT;
      if (shot) {
        await page.setViewportSize({ width: 1280, height: 1250 });
        await editor(page).locator("h1, p").first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: shot, fullPage: false });
        await page.setViewportSize({ width: 1280, height: 720 });
      }

      // Reload: the Yjs log kept the picture, its settings, the shape and chart.
      await page.waitForTimeout(2500);
      await page.reload();
      await expect(picture(page)).toBeVisible({ timeout: 15_000 });
      await expect(picture(page)).toHaveAttribute("data-wrap", "square");
      await expect(picture(page).locator("img")).toHaveAttribute("src", src);
      await expect(picture(page).locator("img")).toHaveAttribute("alt", "Blue and green gradient with a yellow circle");
      await expect(picture(page)).toHaveCSS("width", "243px");
      await expect(editor(page).locator('.doc-obj[data-type="shape"] .doc-shape-inner')).toHaveText("Shape text");
      await expect(editor(page).locator(".doc-chart-root svg")).toBeVisible({ timeout: 10_000 });

      // .docx out and back in.
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByText("Download", { exact: true }).click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click()]);
      const bytes = await readFile((await download.path())!);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      ids.push(await importFromHome(page, "M7 images.docx", bytes));
      await expect(picture(page)).toBeVisible({ timeout: 15_000 });
      await expect(picture(page)).toHaveAttribute("data-wrap", "square");
      await expect(picture(page).locator("img")).toHaveAttribute("alt", "Blue and green gradient with a yellow circle");
      await expect(picture(page)).toHaveCSS("width", "243px");
      await expect(editor(page).locator('.doc-obj[data-type="shape"] .doc-shape-inner')).toHaveText("Shape text");
      await expect(editor(page).locator(".doc-chart-root svg")).toBeVisible({ timeout: 10_000 });
    } finally {
      for (const id of ids) await trashDoc(page.request, id);
    }
  });

  test("behind / in front objects don't move text; arrange and flip", async ({ page }) => {
    const id = await createDoc(page.request, "e2e images layering");
    try {
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("Text over a picture behind it.");
      await editor(page).locator("p").first().click({ position: { x: 2, y: 8 } });
      const png = await makePng(page);
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menu(page, "Insert", "Image from computer…")]);
      await chooser.setFiles({ name: "p.png", mimeType: "image/png", buffer: png });
      await expect(picture(page).locator("img")).toHaveAttribute("src", /\/assets\//, { timeout: 15_000 });
      const textTop = async () =>
        page.evaluate(() => {
          const p = document.querySelector(".ProseMirror p")!;
          const r = document.createRange();
          const t = Array.from(p.childNodes).find((n) => n.nodeType === 3)!;
          r.selectNodeContents(t);
          return r.getBoundingClientRect().top;
        });
      const inlineTop = await textTop();
      await menu(page, "Format", "Image settings…");
      const panel = page.getByTestId("object-settings");
      await panel.getByTestId("obj-wrap").click();
      await page.getByRole("option", { name: "Behind text" }).click();
      await expect(picture(page)).toHaveCSS("position", "absolute");
      await expect(picture(page)).toHaveCSS("z-index", "-1");
      // Out of the flow: the text moved up to the paragraph's first line.
      expect(await textTop()).toBeLessThan(inlineTop);
      await panel.getByTestId("obj-wrap").click();
      await page.getByRole("option", { name: "In front of text" }).click();
      await expect(picture(page)).toHaveCSS("position", "absolute");
      expect(Number(await picture(page).evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(0);
      await panel.getByRole("button", { name: "Flip horizontally" }).click();
      await expect(picture(page).locator(".doc-obj-frame")).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
      await panel.getByRole("button", { name: "Rotate right" }).click();
      await expect(panel.getByTestId("obj-rotate")).toHaveValue("90");
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
