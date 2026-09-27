import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { BASE_URL, trashDoc } from "./helpers";

// CC8: legacy .doc import through the optional LibreOffice converter.
//
// Needs a backend started with GROWN_LIBREOFFICE=1 (e.g.
// `GROWN_LIBREOFFICE=1 GROWN_PORT=8096 deploy/local/stack.sh deploy`) and a
// local soffice to author the fixture: the test writes a flat-ODF document and
// has soffice save it as a Word 97 .doc (nothing is checked in). It skips when
// the server reports the converter disabled or soffice isn't installed.

const run = promisify(execFile);

function findSoffice(): string | null {
  const candidates = [
    process.env.GROWN_SOFFICE_PATH,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "/opt/libreoffice/program/soffice",
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

const FODT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:automatic-styles><style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>
<office:body><office:text>
<text:h text:outline-level="1">Legacy memo</text:h>
<text:p>Written in Word 97 format with <text:span text:style-name="B">bold words</text:span> inside.</text:p>
<table:table table:name="T1"><table:table-column table:number-columns-repeated="2"/>
<table:table-row><table:table-cell><text:p>Quarter</text:p></table:table-cell><table:table-cell><text:p>Revenue</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>Q1</text:p></table:table-cell><table:table-cell><text:p>1200</text:p></table:table-cell></table:table-row>
</table:table>
</office:text></office:body></office:document>`;

let docBytes: Buffer | null = null;
let skipReason = "";

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const caps = await request.get(`${BASE_URL}/api/v1/convert/capabilities`);
  const j = caps.ok() ? await caps.json() : { enabled: false };
  if (!j.enabled) {
    skipReason = "server started without GROWN_LIBREOFFICE=1";
    return;
  }
  const soffice = findSoffice();
  if (!soffice) {
    skipReason = "soffice not installed locally (needed to author the .doc fixture)";
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "grown-e2e-doc-"));
  try {
    const src = path.join(dir, "memo.fodt");
    await writeFile(src, FODT);
    await run(
      soffice,
      [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--norestore", "--convert-to", "doc:MS Word 97", "--outdir", dir, src],
      { timeout: 150_000 },
    );
    docBytes = await readFile(path.join(dir, "memo.doc"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.describe("CC8 LibreOffice legacy import", () => {
  test.beforeEach(() => {
    test.skip(!!skipReason, skipReason);
  });

  test("capabilities list the legacy formats", async ({ request }) => {
    const j = await (await request.get(`${BASE_URL}/api/v1/convert/capabilities`)).json();
    expect(j.formats).toMatchObject({ doc: "docx", xls: "xlsx", ppt: "pptx" });
    expect(j.legacy).toEqual(expect.arrayContaining(["doc", "xls", "ppt"]));
  });

  test("the converter rejects files that aren't what they claim", async ({ request }) => {
    const r = await request.post(`${BASE_URL}/api/v1/convert/office?from=doc`, {
      headers: { "Content-Type": "application/octet-stream" },
      data: Buffer.from("<html><img src='http://169.254.169.254/'></html>"),
    });
    expect(r.status()).toBe(422);
    const bad = await request.post(`${BASE_URL}/api/v1/convert/office?from=exe`, { data: Buffer.from("MZ") });
    expect(bad.status()).toBe(415);
  });

  test("imports a Word 97 .doc from the Docs home", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("tile-docs").click();
    await expect(page.getByTestId("docs-import")).toBeVisible();
    // The picker offers .doc only once the capabilities have loaded.
    await expect(page.getByTestId("docs-import-input")).toHaveAttribute("accept", /\.doc(,|$)/);

    let id = "";
    try {
      await page.getByTestId("docs-import-input").setInputFiles({
        name: "Legacy memo.doc",
        mimeType: "application/msword",
        buffer: docBytes!,
      });
      await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 180_000 });
      id = page.url().split("/").pop()!;
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const ed = page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();
      await expect(ed.locator("h1")).toHaveText("Legacy memo");
      await expect(ed.locator("strong", { hasText: "bold words" })).toBeVisible();
      await expect(ed).toContainText("Written in Word 97 format with bold words inside.");
      await expect(ed.locator("table tr")).toHaveCount(2);
      await expect(ed.locator("table")).toContainText("Revenue");
      await expect(ed.locator("table")).toContainText("1200");
    } finally {
      if (id) await trashDoc(page.request, id);
    }
  });
});
