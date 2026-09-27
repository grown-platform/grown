import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, saveDeckData, trashDeck } from "./helpers";

// Slides M11: a chart with its data sheet, a SmartArt-lite process diagram
// edited through its outline, word art with effects and a warp, and
// video/audio (upload with a poster frame, a YouTube link, playback in the
// slideshow). GROWN_SLIDES_M11_SHOT=<file.png> saves the finished slide.

const SHOT = process.env.GROWN_SLIDES_M11_SHOT;

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  chart?: { type: string; title: string; data: string[][] };
  diagram?: { layout: string; outline: string };
  children?: El[];
  wordArt?: { warp?: string; gradient?: unknown; outline?: unknown };
  media?: { kind: string; src: string; poster?: string; mime?: string; loop?: boolean; autoplay?: boolean; embed?: { provider: string; id: string } };
};

async function elements(page: Page, id: string): Promise<El[]> {
  const d = (await getDeckData(page.request, id)) as { slides: { elements: El[] }[] };
  return d.slides[0].elements;
}

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("slide-canvas").boundingBox())!;
  const s = box.width / 960;
  return { x: box.x + x * s, y: box.y + y * s };
}

/** Drag from one slide point to another with snapping off (Alt). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await toScreen(page, from.x, from.y);
  const b = await toScreen(page, to.x, to.y);
  await page.keyboard.down("Alt");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

/** Drag an element's bottom-right handle to a slide point (grabbed on its
 *  inner quarter: a text box clips the outer half of its handles). */
async function resizeTo(page: Page, elId: string, to: { x: number; y: number }) {
  const h = (await page.locator(`[data-el-id="${elId}"] [data-handle="se"]`).boundingBox())!;
  const b = await toScreen(page, to.x, to.y);
  await page.keyboard.down("Alt");
  await page.mouse.move(h.x + h.width * 0.3, h.y + h.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

async function insertMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("chart, process diagram and word art: insert, edit, persist", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides objects");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: [] }] });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    await expect(page.getByTestId("slide-canvas")).toBeVisible();

    // ---- chart ----
    await insertMenu(page, "Chart…");
    const chartDlg = page.getByRole("dialog", { name: "Chart" });
    await expect(chartDlg.getByTestId("chart-grid")).toBeVisible();
    // oo:slide/shortcuts/shortcuts.js#Check select all in chart title (grown-variant):
    // the title is edited in the chart dialog; Ctrl+A there selects all of it.
    const title = chartDlg.getByLabel("Chart title");
    await title.fill("Diagram Title");
    await title.press("ControlOrMeta+a");
    expect(await title.evaluate((n: HTMLInputElement) => n.value.slice(n.selectionStart ?? 0, n.selectionEnd ?? 0))).toBe("Diagram Title");
    await title.fill("Quarterly sales");
    await chartDlg.getByLabel("Cell 2,2").fill("6.2");
    await chartDlg.getByLabel("Cell 1,4").fill("West");
    await chartDlg.getByRole("button", { name: "Insert", exact: true }).click();
    const chart = page.locator('[data-el-type="chart"]');
    await expect(chart.locator('svg[data-chart-type="column"]')).toBeVisible();
    await expect(chart.getByText("Quarterly sales")).toBeVisible();
    const chartId = (await chart.getAttribute("data-el-id"))!;
    // Place it on the left half.
    await drag(page, { x: 480, y: 270 }, { x: 270, y: 330 });
    await resizeTo(page, chartId, { x: 470, y: 520 });

    // Edit its data again: double-click opens the editor; switch to lines and back.
    await chart.dblclick();
    const edit = page.getByRole("dialog", { name: "Chart" });
    await expect(edit.getByText("Edit chart")).toBeVisible();
    await expect(edit.getByLabel("Cell 2,2")).toHaveValue("6.2");
    await edit.getByRole("combobox", { name: "Chart type" }).click();
    await page.getByRole("option", { name: "Line" }).click();
    await edit.getByRole("button", { name: "Apply" }).click();
    await expect(chart.locator('svg[data-chart-type="line"]')).toBeVisible();
    await page.getByRole("button", { name: "Edit chart" }).click();
    await page.getByRole("dialog", { name: "Chart" }).getByRole("combobox", { name: "Chart type" }).click();
    await page.getByRole("option", { name: "Column" }).click();
    await page.getByRole("dialog", { name: "Chart" }).getByRole("button", { name: "Apply" }).click();
    await expect(chart.locator('svg[data-chart-type="column"]')).toBeVisible();

    // ---- SmartArt-lite process diagram ----
    await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await insertMenu(page, "Diagram…");
    const dd = page.getByRole("dialog", { name: "Diagram" });
    await dd.getByRole("radio", { name: "Process" }).click();
    await dd.getByLabel("Outline").fill("Plan\nBuild\nShip");
    await expect(dd.getByTestId("diagram-preview").getByText("Build")).toBeVisible();
    await dd.getByRole("button", { name: "Insert", exact: true }).click();
    const group = page.locator('[data-el-type="group"]');
    await expect(group).toHaveCount(1);
    await expect(group.locator('svg[data-preset="roundRect"]')).toHaveCount(3);
    const groupId = (await group.getAttribute("data-el-id"))!;
    // Outline panel: add a sub-item (Tab indents) and a fourth step.
    await group.dblclick();
    const od = page.getByRole("dialog", { name: "Diagram" });
    await expect(od.getByText("Edit diagram")).toBeVisible();
    const outline = od.getByLabel("Outline");
    await outline.click();
    await outline.press("ControlOrMeta+End");
    await outline.press("Enter");
    await outline.pressSequentially("Grow");
    await outline.press("Enter");
    await outline.press("Tab");
    await outline.pressSequentially("Measure");
    await expect(outline).toHaveValue("Plan\nBuild\nShip\nGrow\n\tMeasure");
    await od.getByRole("button", { name: "Apply" }).click();
    await expect(group.locator('svg[data-preset="roundRect"]')).toHaveCount(4);
    await expect(group.getByText("• Measure")).toBeVisible();
    // Right half, under the title.
    await resizeTo(page, groupId, { x: 96 + 450, y: 108 + 230 });
    await drag(page, { x: 321, y: 223 }, { x: 712, y: 360 });

    // ---- word art ----
    await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await insertMenu(page, "Word art");
    const wa = page.locator('[data-el-type="text"]');
    await expect(wa.locator("[data-wordart]")).toBeVisible();
    const waId = (await wa.getAttribute("data-el-id"))!;
    // Gradient text clipped to the glyphs, with a drop shadow.
    await expect(wa.locator("[data-wordart]")).toHaveCSS("-webkit-text-fill-color", "rgba(0, 0, 0, 0)");
    await expect(wa.locator("[data-wordart]")).toHaveCSS("filter", /drop-shadow/);
    // Retype the text.
    await wa.dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Grown Slides");
    await page.keyboard.press("Escape");
    // Top of the slide, taller, then an arch warp and an outline from the dialog.
    await drag(page, { x: 480, y: 270 }, { x: 480, y: 95 });
    await expect(wa).toHaveAttribute("data-selected", "true");
    await resizeTo(page, waId, { x: 800, y: 200 });
    await expect(wa).toHaveAttribute("data-selected", "true");
    await page.getByRole("button", { name: "Word art", exact: true }).click();
    const wd = page.getByRole("dialog", { name: "Word art" });
    await wd.getByRole("combobox", { name: "Warp" }).click();
    await page.getByRole("option", { name: "Arch up" }).click();
    await wd.getByRole("checkbox", { name: "Outline" }).check();
    const saved = waitForSave(page, id);
    await wd.getByRole("button", { name: "Apply" }).click();
    await expect(wa.locator('[data-warp="textArchUp"] textPath')).toHaveText("Grown Slides");
    await saved;
    await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });

    // ---- reload and check ----
    await page.reload();
    await expect(page.getByTestId("slide-canvas")).toBeVisible();
    const els = await elements(page, id);
    const c = els.find((e) => e.type === "chart")!;
    expect(c.chart!.type).toBe("column");
    expect(c.chart!.title).toBe("Quarterly sales");
    expect(c.chart!.data[0][3]).toBe("West");
    expect(c.chart!.data[1][1]).toBe("6.2");
    expect(c.x).toBeLessThan(100);
    const g = els.find((e) => e.type === "group")!;
    expect(g.diagram).toEqual({ layout: "process", outline: "Plan\nBuild\nShip\nGrow\n\tMeasure" });
    expect(g.x).toBeGreaterThan(450);
    const t = els.find((e) => e.type === "text")!;
    expect(t.text).toBe("Grown Slides");
    expect(t.wordArt!.warp).toBe("textArchUp");
    expect(t.wordArt!.gradient).toBeTruthy();
    expect(t.wordArt!.outline).toBeTruthy();
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas.locator('[data-el-type="chart"] svg[data-chart-type="column"]')).toBeVisible();
    await expect(canvas.locator('[data-el-type="group"] svg[data-preset="roundRect"]')).toHaveCount(4);
    await expect(canvas.locator('[data-warp="textArchUp"]')).toBeVisible();
    // The thumbnail draws them too.
    const thumb = page.getByTestId("slide-thumb").first();
    await expect(thumb.locator('svg[data-chart-type="column"]')).toBeVisible();
    await expect(thumb.locator('[data-warp="textArchUp"]')).toBeVisible();
    if (SHOT) await page.getByTestId("slide-canvas").screenshot({ path: SHOT });
  } finally {
    await trashDeck(page.request, id);
  }
});

/** A short WebM clip recorded from a canvas by the browser. */
async function webmBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const g = c.getContext("2d")!;
    let f = 0;
    const paint = () => {
      g.fillStyle = `hsl(${(f * 25) % 360}, 70%, 45%)`;
      g.fillRect(0, 0, 320, 180);
      g.fillStyle = "#fff";
      g.font = "bold 40px sans-serif";
      g.fillText(`Clip ${f++}`, 70, 105);
    };
    paint();
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const iv = window.setInterval(paint, 50);
    rec.start();
    await new Promise((r) => setTimeout(r, 1200));
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.stop();
    await stopped;
    window.clearInterval(iv);
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}

test("video upload with a poster, a YouTube link, playback in the slideshow", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides video");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: [] }] });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    await expect(page.getByTestId("slide-canvas")).toBeVisible();

    // ---- upload ----
    const clip = await webmBytes(page);
    await insertMenu(page, "Video…");
    const md = page.getByRole("dialog", { name: "Video" });
    // A file that isn't media is refused before upload.
    await md.getByTestId("media-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
    await expect(md.getByText(/Unsupported media type/)).toBeVisible();
    await expect(md.getByRole("button", { name: "Insert", exact: true })).toBeDisabled();
    await md.getByTestId("media-file").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
    await md.getByRole("checkbox", { name: "Loop" }).check();
    const up = page.waitForResponse((r) => r.url().includes(`/api/v1/slides/d/${id}/assets`) && r.request().method() === "POST");
    await md.getByRole("button", { name: "Insert", exact: true }).click();
    const upRes = await up;
    expect(upRes.status()).toBe(201);
    expect((await upRes.json()).mime).toBe("video/webm");
    const vid = page.locator('[data-el-type="media"]');
    await expect(vid).toHaveCount(1);
    // The editor shows the poster frame captured from the clip.
    await expect(vid.locator("[data-media-poster] img")).toBeVisible();

    // Playback options from the toolbar.
    await page.getByRole("button", { name: "Playback", exact: true }).click();
    const pd = page.getByRole("dialog", { name: "Video" });
    await expect(pd.getByRole("checkbox", { name: "Loop" })).toBeChecked();
    await pd.getByRole("checkbox", { name: "Play automatically" }).check();
    await pd.getByRole("checkbox", { name: "Mute" }).check();
    let saved = waitForSave(page, id);
    await pd.getByRole("button", { name: "Apply" }).click();
    await saved;
    // Move it left.
    await drag(page, { x: 480, y: 270 }, { x: 240, y: 270 });

    // ---- YouTube link ----
    await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await insertMenu(page, "Video…");
    const ud = page.getByRole("dialog", { name: "Video" });
    await ud.getByRole("tab", { name: "By URL" }).click();
    await ud.getByLabel("Media URL").fill("https://example.com/page.html");
    await expect(ud.getByText(/Paste a YouTube or Vimeo link/)).toBeVisible();
    await ud.getByLabel("Media URL").fill("https://youtu.be/dQw4w9WgXcQ");
    await expect(ud.getByText("YouTube video")).toBeVisible();
    saved = waitForSave(page, id);
    await ud.getByRole("button", { name: "Insert", exact: true }).click();
    await saved;
    await expect(page.locator('[data-el-type="media"]')).toHaveCount(2);
    // Beside the uploaded clip.
    await drag(page, { x: 480, y: 270 }, { x: 725, y: 270 });

    // ---- model ----
    const els = await elements(page, id);
    const up1 = els.find((e) => e.media && !e.media.embed)!;
    expect(up1.media!.src).toMatch(new RegExp(`^/api/v1/slides/d/${id}/assets/[0-9a-f]{64}$`));
    expect(up1.media!.poster).toMatch(new RegExp(`^/api/v1/slides/d/${id}/assets/[0-9a-f]{64}$`));
    expect(up1.media).toMatchObject({ kind: "video", loop: true, autoplay: true });
    expect(up1.w / up1.h).toBeCloseTo(16 / 9, 1);
    const yt = els.find((e) => e.media?.embed)!;
    expect(yt.media).toMatchObject({ kind: "video", embed: { provider: "youtube", id: "dQw4w9WgXcQ" }, poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    // The clip is served with byte ranges.
    const part = await page.request.get(`${BASE_URL}${up1.media!.src}`, { headers: { Range: "bytes=0-3" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-type"]).toBe("video/webm");
    expect([...(await part.body())]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

    // ---- slideshow ----
    await page.getByRole("button", { name: "Present", exact: true }).click();
    const show = page.getByTestId("slideshow");
    await expect(show).toBeVisible();
    const player = show.locator('video[data-media-player="video"]');
    await expect(player).toHaveAttribute("loop", "");
    await expect(player).toHaveAttribute("src", up1.media!.src);
    expect(await player.evaluate((v: HTMLVideoElement) => v.autoplay && v.muted)).toBe(true);
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
    // A click on the clip plays/pauses it and does not advance the show.
    await player.click();
    await expect(show).toHaveAttribute("data-slide", "0");
    // The YouTube clip starts on click: poster first, then the player frame.
    const start = show.locator("[data-media-start]");
    await expect(start).toBeVisible();
    await start.click();
    await expect(show).toHaveAttribute("data-slide", "0");
    const frame = show.locator('iframe[data-media-embed="youtube"]');
    await expect(frame).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?.*autoplay=1/);
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
  } finally {
    await trashDeck(page.request, id);
  }
});
