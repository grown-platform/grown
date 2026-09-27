import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M10: build a form with every field type from the Forms menu, protect
// the document for filling forms only, fill it in from a second view (only
// the fields take input; Tab moves between them; masks fill in literals),
// export the values as JSON, submit, and round-trip the form through .docx.
//
// Screenshots of the edit and fill views go to $DOCS_M10_SCREENSHOTS
// (a directory) when set.

const editor = (page: Page) => page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();
const shots = process.env.DOCS_M10_SCREENSHOTS;

async function formsMenu(page: Page, item: string) {
  await page.getByTestId("menu-forms").click();
  await page.getByTestId(item).click();
  await page.waitForTimeout(150);
}

/** Caret at the end of paragraph `i` of the body. */
async function endOf(page: Page, i: number) {
  await editor(page).locator("> p").nth(i).click();
  await page.keyboard.press("End");
  await page.waitForTimeout(100);
}

const LINES = ["Name: ", "Email: ", "Phone: ", "I agree: ", "Small: ", "Large: ", "Colour: ", "Start date: ", "Notes: ", "Photo: "];

test.describe.serial("docs forms (M10)", () => {
  test("build, protect, fill, export and round-trip a form", async ({ page, context }) => {
    test.setTimeout(120_000);
    const ids: string[] = [];
    try {
      const id = await createDoc(page.request, "M10 form");
      ids.push(id);
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("Application form");
      for (const l of LINES) {
        await page.keyboard.press("Enter");
        await page.keyboard.type(l.trimEnd());
      }
      await page.waitForTimeout(200);

      // One field per line.
      const fields: [number, string][] = [
        [1, "form-insert-text"],
        [2, "form-insert-email"],
        [3, "form-insert-phone"],
        [4, "form-insert-checkbox"],
        [5, "form-insert-radio"],
        [6, "form-insert-radio"],
        [7, "form-insert-dropDownList"],
        [8, "form-insert-date"],
        [9, "cc-insert-richText"],
        [10, "form-insert-picture"],
      ];
      for (const [line, item] of fields) {
        await endOf(page, line);
        await page.keyboard.type(" ");
        await formsMenu(page, item);
      }
      const ed = editor(page);
      await expect(ed.locator(".doc-sdt")).toHaveCount(10);
      await expect(ed.locator(".doc-sdt[data-form]")).toHaveCount(9);
      await expect(ed.locator('.doc-sdt[data-radio]')).toHaveCount(2);

      // Settings on the name field: key and required.
      await ed.locator(".doc-sdt").first().click();
      await page.waitForTimeout(100);
      await formsMenu(page, "cc-settings");
      await expect(page.getByTestId("cc-settings-dialog")).toBeVisible();
      await page.getByTestId("form-key").fill("name");
      await page.getByTestId("cc-title").fill("Full name");
      await page.getByTestId("form-required").check();
      await page.getByTestId("cc-settings-ok").click();
      await expect(ed.locator('.doc-sdt[data-form="name"][data-required]')).toHaveCount(1);
      // The plain rich-text control takes text in the edit view.
      await ed.locator('.doc-sdt[data-sdt="richText"]').click();
      await page.keyboard.type("Author notes");
      await expect(ed.locator('.doc-sdt[data-sdt="richText"]')).toHaveText("Author notes");

      if (shots) await page.screenshot({ path: `${shots}/docs-m10-edit.png` });

      // Protect: filling forms only.
      await formsMenu(page, "forms-protect");
      await page.getByTestId("protect-forms").check();
      await page.getByTestId("protect-ok").click();
      await expect(page.getByTestId("forms-fill-bar")).toBeVisible();
      await page.waitForTimeout(800);

      // A second view fills the form.
      const view = await context.newPage();
      await openDoc(view, id);
      const ved = editor(view);
      await expect(view.getByTestId("forms-fill-bar")).toContainText("Protected: filling forms only");
      await expect(view.getByTestId("forms-status")).toContainText("1 of 1 required left");
      // Text outside the fields can't change.
      await ved.locator("> p").first().click();
      await view.keyboard.type("XYZ");
      await expect(ved.locator("> p").first()).toHaveText("Application form");

      await view.keyboard.press("Tab");
      await view.waitForTimeout(100);
      await view.keyboard.type("Ada Lovelace");
      await view.keyboard.press("Tab");
      await view.waitForTimeout(100);
      await view.keyboard.type("ada@example.com");
      await view.keyboard.press("Tab");
      await view.waitForTimeout(100);
      await view.keyboard.type("5551234567");
      await expect(ved.locator(".doc-sdt").nth(2)).toHaveText("(555) 123-4567");
      await view.keyboard.press("Tab");
      await view.waitForTimeout(100);
      await view.keyboard.press("Space");
      await view.keyboard.press("Tab");
      await view.keyboard.press("Tab");
      await view.waitForTimeout(100);
      await view.keyboard.press("Space"); // the second radio button
      await view.keyboard.press("Tab");
      await view.waitForTimeout(150);
      await view.getByTestId("sdt-item").nth(1).click();
      await view.keyboard.press("Tab");
      await view.waitForTimeout(150);
      await view.getByTestId("sdt-date-input").fill("2026-10-01");
      await view.waitForTimeout(100);
      await expect(ved.locator('.doc-sdt[data-sdt="date"]')).toHaveText("10/1/2026");
      // The picture field.
      const [chooser] = await Promise.all([view.waitForEvent("filechooser"), ved.locator('.doc-sdt[data-sdt="picture"]').click()]);
      await chooser.setFiles({
        name: "dot.png",
        mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
      });
      await expect(ved.locator("img.doc-sdt-pic")).toHaveCount(1);
      await expect(view.getByTestId("forms-status")).toContainText("0 of 1 required left");

      await expect(ved.locator(".doc-sdt").first()).toHaveText("Ada Lovelace");
      await expect(ved.locator(".doc-sdt").nth(1)).toHaveText("ada@example.com");
      await expect(ved.locator('.doc-sdt[data-sdt="checkbox"]').first()).toHaveText("☒");
      await expect(ved.locator(".doc-sdt[data-radio]").nth(1)).toHaveText("◉");
      if (shots) await view.screenshot({ path: `${shots}/docs-m10-fill.png` });

      // Export the values as JSON.
      const [dl] = await Promise.all([view.waitForEvent("download"), view.getByTestId("forms-bar-export").click()]);
      const data = JSON.parse(await readFile((await dl.path())!, "utf8")) as { key: string; value: unknown; type: string }[];
      const byKey = Object.fromEntries(data.map((d) => [d.key, d]));
      expect(byKey.name.value).toBe("Ada Lovelace");
      expect(data.find((d) => d.type === "text" && String(d.value).includes("@"))?.value).toBe("ada@example.com");
      expect(data.find((d) => d.type === "checkBox")?.value).toBe(true);
      expect(data.find((d) => d.type === "radio")?.value).toMatch(/^Choice/);
      expect(data.find((d) => d.type === "dropDownList")?.value).toBe("2");
      expect(data.find((d) => d.type === "dateTime")?.value).toBe("10/1/2026");
      await Promise.all([view.waitForEvent("download"), view.getByTestId("forms-submit").click()]);
      await expect(view.getByTestId("forms-submitted")).toBeVisible();

      // The first view sees the filled values.
      await expect(ed.locator(".doc-sdt").first()).toHaveText("Ada Lovelace");

      // .docx round trip: fields, values and protection come back.
      await view.waitForTimeout(1000);
      await view.getByRole("button", { name: "File", exact: true }).click();
      await view.getByText("Download", { exact: true }).click();
      const [docx] = await Promise.all([view.waitForEvent("download"), view.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click()]);
      const bytes = await readFile((await docx.path())!);
      expect(bytes.includes(Buffer.from("word/document.xml"))).toBe(true);
      await view.goto(`${BASE_URL}/`);
      await view.getByTestId("tile-docs").click();
      await view.getByTestId("docs-import-input").setInputFiles({
        name: "M10 form.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: bytes,
      });
      await view.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
      ids.push(view.url().split("/").pop()!);
      await expect(view.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const red = editor(view);
      await expect(red.locator(".doc-sdt")).toHaveCount(10);
      await expect(red.locator(".doc-sdt").first()).toHaveText("Ada Lovelace");
      await expect(red.locator('.doc-sdt[data-form="name"][data-required]')).toHaveCount(1);
      await expect(red.locator('.doc-sdt[data-sdt="date"]')).toHaveText("10/1/2026");
      await expect(view.getByTestId("forms-fill-bar")).toContainText("Protected: filling forms only");
      await view.close();
    } finally {
      for (const id of ids) await trashDoc(page.request, id);
    }
  });
});
