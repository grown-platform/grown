import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  buildVsdx,
  cell,
  xform,
  geom,
  rectGeom,
  ellipseGeom,
  shape,
} from "../app/src/pages/whiteboard/vsdxFixture";

// Whiteboard .vsdx import + export through the UI. The .vsdx is generated in
// code (no fixture files are checked in): page 1 holds a labelled rectangle
// and ellipse joined by a glued connector plus a triangle; page 2 a diamond.

async function sampleVsdx(): Promise<Buffer> {
  const bytes = await buildVsdx({
    pages: [
      {
        name: "Flow",
        width: 11,
        height: 8.5,
        shapes:
          shape(
            1,
            xform(2.5, 6, 2.5, 1.2) +
              cell("FillForegnd", "#cfe2ff") +
              cell("LineColor", "#1f4e99") +
              rectGeom(2.5, 1.2) +
              `<Text>Start</Text>`,
          ) +
          shape(
            2,
            xform(8, 6, 2, 1.2) +
              cell("FillForegnd", "#ffe8a3") +
              ellipseGeom(2, 1.2) +
              `<Text>Finish</Text>`,
          ) +
          shape(
            3,
            cell("BeginX", 3.75) +
              cell("BeginY", 6) +
              cell("EndX", 7) +
              cell("EndY", 6) +
              cell("EndArrow", 4) +
              `<Text>go</Text>`,
          ) +
          shape(
            4,
            xform(5.5, 3, 2, 1.8) +
              cell("FillForegnd", "#b7e4c7") +
              geom([
                ["MoveTo", { X: 0, Y: 0 }],
                ["LineTo", { X: 2, Y: 0 }],
                ["LineTo", { X: 1, Y: 1.8 }],
                ["LineTo", { X: 0, Y: 0 }],
              ]) +
              `<Text>Triangle</Text>`,
          ),
        connects:
          `<Connect FromSheet="3" FromCell="BeginX" ToSheet="1" ToCell="PinX"/>` +
          `<Connect FromSheet="3" FromCell="EndX" ToSheet="2" ToCell="PinX"/>`,
      },
      {
        name: "Decision",
        width: 6,
        height: 4,
        shapes: shape(
          1,
          xform(3, 2, 2, 1.2) +
            geom([
              ["MoveTo", { X: 1, Y: 0 }],
              ["LineTo", { X: 2, Y: 0.6 }],
              ["LineTo", { X: 1, Y: 1.2 }],
              ["LineTo", { X: 0, Y: 0.6 }],
              ["LineTo", { X: 1, Y: 0 }],
            ]) +
            `<Text>OK?</Text>`,
        ),
      },
    ],
  });
  return Buffer.from(bytes);
}

async function sceneOf(page: Page, id: string): Promise<any[]> {
  const r = await page.request.get(`/api/v1/whiteboards/d/${id}`);
  const wb = await r.json();
  return wb.data ? JSON.parse(wb.data).elements ?? [] : [];
}

test("whiteboard: import .vsdx from home, then export SVG/PNG/.excalidraw", async ({
  page,
}) => {
  const vsdx = await sampleVsdx();
  await page.goto("/whiteboard");
  await page
    .getByTestId("import-vsdx")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "Flow chart.vsdx",
      mimeType: "application/vnd.ms-visio.drawing.main+xml",
      buffer: vsdx,
    });
  await page.waitForURL(/\/whiteboard\/d\//);
  const id = page.url().split("/whiteboard/d/")[1];
  await expect(page.getByTestId("whiteboard-notice")).toContainText(
    "from 2 pages",
  );
  await expect(page.getByLabel("Whiteboard title")).toHaveValue("Flow chart");

  // Autosave persists the converted scene.
  let els: any[] = [];
  await expect
    .poll(async () => (els = await sceneOf(page, id)).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(8);
  const types = new Set(els.map((e) => e.type));
  for (const t of ["rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame"])
    expect(types, t).toContain(t);
  const texts = els.filter((e) => e.type === "text").map((e) => e.text);
  expect(texts).toEqual(
    expect.arrayContaining(["Start", "Finish", "go", "Triangle", "OK?"]),
  );
  const rect = els.find((e) => e.type === "rectangle");
  const ellipse = els.find((e) => e.type === "ellipse");
  const arrow = els.find((e) => e.type === "arrow");
  expect(rect.backgroundColor).toBe("#cfe2ff");
  expect(arrow.startBinding?.elementId).toBe(rect.id);
  expect(arrow.endBinding?.elementId).toBe(ellipse.id);
  expect(els.filter((e) => e.type === "frame").map((f) => f.name)).toEqual([
    "Flow",
    "Decision",
  ]);

  await page
    .getByTestId("whiteboard-canvas")
    .screenshot({ path: process.env.VSDX_SHOT ?? "test-results/whiteboard-vsdx.png" });

  // Export SVG.
  await page.getByTestId("whiteboard-file-menu").click();
  const [svgDl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export as SVG" }).click(),
  ]);
  expect(svgDl.suggestedFilename()).toBe("Flow chart.svg");
  const svg = await readFile(await svgDl.path());
  const svgText = svg.toString("utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain("Start");

  // Export PNG.
  await page.getByTestId("whiteboard-file-menu").click();
  const [pngDl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export as PNG" }).click(),
  ]);
  expect(pngDl.suggestedFilename()).toBe("Flow chart.png");
  const png = await readFile(await pngDl.path());
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");

  // Download .excalidraw.
  await page.getByTestId("whiteboard-file-menu").click();
  const [jsonDl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download .excalidraw" }).click(),
  ]);
  expect(jsonDl.suggestedFilename()).toBe("Flow chart.excalidraw");
  const json = JSON.parse((await readFile(await jsonDl.path())).toString("utf8"));
  expect(json.type).toBe("excalidraw");
  expect(json.elements.length).toBe(els.length);

  // Import again from the editor's File menu: appended to the right.
  const before = els.length;
  await page.getByTestId("vsdx-input").setInputFiles({
    name: "again.vsdx",
    mimeType: "application/vnd.ms-visio.drawing.main+xml",
    buffer: vsdx,
  });
  await expect
    .poll(async () => (await sceneOf(page, id)).length, { timeout: 15_000 })
    .toBe(before * 2);

  await page.request.delete(`/api/v1/whiteboards/d/${id}`);
});
