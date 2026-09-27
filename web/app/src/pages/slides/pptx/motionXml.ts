// pptx transitions and animations (M8), written from ECMA-376 Part 1
// §19.3.1.53 (p:transition), §19.5 (p:timing) and PowerPoint's preset
// numbering for animation effects (presetID/presetSubtype). Newer
// transitions (reveal, morph) and exact durations use the PowerPoint 2010
// / 2015 extensions inside mc:AlternateContent, with a classic fallback.

import type { AnimEffect, AnimKind, AnimStart, Slide } from "../model";
import { buildTimeline, effectsOf, kindDef, type TimedEffect } from "../animOps";
import { normalizeTransition, slideTransition, transitionDef } from "../transitions";

const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const P159_NS = "http://schemas.microsoft.com/office/powerpoint/2015/09/main";

// ------------------------------------------------------------ transitions

type TransitionSlide = Pick<Slide, "transition" | "transitionDir" | "transitionDur" | "advanceOnClick" | "advanceAfter">;

function spdOf(ms: number): "fast" | "med" | "slow" {
  return ms <= 500 ? "fast" : ms <= 750 ? "med" : "slow";
}

/**
 * The `<p:transition>` for a slide (or a bare transition type), or "" when
 * there is nothing to write. Directions follow PowerPoint: "Push from
 * right" moves the old slide left (`dir="l"`). A custom duration, reveal
 * and morph are written as `mc:AlternateContent` (p14:dur, p14:reveal,
 * p159:morph) with a classic fallback.
 */
export function transitionXml(s: TransitionSlide | TransitionSlide["transition"]): string {
  const slide: TransitionSlide = typeof s === "object" ? s : { transition: s };
  const n = normalizeTransition(slide.transition, slide.transitionDir);
  const { type, dir, dur } = slideTransition({ ...slide, transition: n.type, transitionDir: n.dir });
  const adv =
    (slide.advanceOnClick === false ? ` advClick="0"` : "") +
    (slide.advanceAfter !== undefined && slide.advanceAfter >= 0 ? ` advTm="${Math.round(slide.advanceAfter)}"` : "");
  if (type === "none") return adv ? `<p:transition${adv}/>` : "";
  let body = "";
  let ext: "" | "p14" | "p159" = "";
  let fallback = "<p:fade/>";
  switch (type) {
    case "fade":
      body = dir === "black" ? `<p:fade thruBlk="1"/>` : "<p:fade/>";
      break;
    case "push":
    case "wipe":
    case "cover":
      body = `<p:${type} dir="${dir}"/>`;
      break;
    case "uncover":
      body = `<p:pull dir="${dir}"/>`;
      break;
    case "split": {
      const [orient, io] = dir.split("-");
      body = `<p:split orient="${orient}" dir="${io}"/>`;
      break;
    }
    case "zoom":
      body = `<p:zoom dir="${dir}"/>`;
      break;
    case "cut":
      body = "<p:cut/>";
      break;
    case "dissolve":
      body = "<p:dissolve/>";
      break;
    case "reveal":
      ext = "p14";
      body = `<p14:reveal dir="${dir}"/>`;
      break;
    case "morph":
      ext = "p159";
      body = `<p159:morph option="byObject"/>`;
      break;
  }
  const spd = ` spd="${spdOf(dur)}"`;
  const custom = slide.transitionDur !== undefined && type !== "cut";
  if (!ext && !custom) return `<p:transition${spd}${adv}>${body}</p:transition>`;
  if (!ext) fallback = body;
  const ns = `xmlns:p14="${P14_NS}"${ext === "p159" ? ` xmlns:p159="${P159_NS}"` : ""}`;
  return (
    `<mc:AlternateContent xmlns:mc="${MC_NS}">` +
    `<mc:Choice ${ns} Requires="${ext || "p14"}"><p:transition${spd}${custom ? ` p14:dur="${Math.round(dur)}"` : ""}${adv}>${body}</p:transition></mc:Choice>` +
    `<mc:Fallback><p:transition${spd}${adv}>${fallback}</p:transition></mc:Fallback>` +
    `</mc:AlternateContent>`
  );
}

const SPD_MS: Record<string, number> = { fast: 500, slow: 1000 };

/** Read a `<p:transition>` into slide fields (the M8 form). */
export function readTransitionEl(tr: Element | null): TransitionSlide {
  if (!tr) return {};
  const out: TransitionSlide = {};
  const dur = tr.getAttributeNS(P14_NS, "dur") || tr.getAttribute("p14:dur");
  if (dur && Number.isFinite(Number(dur))) out.transitionDur = Number(dur);
  else if (tr.getAttribute("spd")) out.transitionDur = SPD_MS[tr.getAttribute("spd")!] ?? 750;
  if (tr.getAttribute("advClick") === "0" || tr.getAttribute("advClick") === "false") out.advanceOnClick = false;
  const tm = tr.getAttribute("advTm");
  if (tm && Number.isFinite(Number(tm))) out.advanceAfter = Number(tm);
  const fx = Array.from(tr.children).find((c) => c.localName !== "sndAc" && c.localName !== "extLst");
  if (!fx) {
    delete out.transitionDur;
    return out;
  }
  const dir = fx.getAttribute("dir");
  const d4 = dir && /^[lrud]$/.test(dir) ? dir : "l";
  switch (fx.localName) {
    case "fade":
      out.transition = "fade";
      if (fx.getAttribute("thruBlk") === "1" || fx.getAttribute("thruBlk") === "true") out.transitionDir = "black";
      break;
    case "push":
    case "wipe":
    case "cover":
      out.transition = fx.localName;
      out.transitionDir = d4;
      break;
    case "pull":
      out.transition = "uncover";
      out.transitionDir = d4;
      break;
    case "split":
      out.transition = "split";
      out.transitionDir = `${fx.getAttribute("orient") === "vert" ? "vert" : "horz"}-${dir === "in" ? "in" : "out"}`;
      break;
    case "zoom":
      out.transition = "zoom";
      out.transitionDir = dir === "out" ? "out" : "in";
      break;
    case "cut":
      out.transition = "cut";
      delete out.transitionDur;
      break;
    case "dissolve":
      out.transition = "dissolve";
      break;
    case "reveal":
      out.transition = "reveal";
      out.transitionDir = dir === "r" ? "r" : "l";
      break;
    case "morph":
      out.transition = "morph";
      break;
    case "pan":
      out.transition = "push";
      out.transitionDir = d4;
      break;
    case "flythrough":
      out.transition = "zoom";
      break;
    default:
      out.transition = "fade";
  }
  // A speed that matches the type's default duration is the default.
  if (!dur && out.transitionDur !== undefined && spdOf(transitionDef(out.transition).dur) === tr.getAttribute("spd"))
    delete out.transitionDur;
  return out;
}

const KNOWN_FX = new Set(["fade", "push", "wipe", "cover", "pull", "split", "zoom", "cut", "dissolve", "reveal", "morph"]);

/** Find the slide's transition: a plain `p:transition`, or the best branch
 *  of an `mc:AlternateContent` (a Choice whose extension Grown reads —
 *  p14, p159 — else the Fallback). */
export function findTransitionEl(root: Element): Element | null {
  for (const c of Array.from(root.children)) {
    if (c.localName === "transition") return c;
    if (c.localName !== "AlternateContent") continue;
    const branches = Array.from(c.children);
    const pick = (b: Element | undefined) => (b ? Array.from(b.children).find((x) => x.localName === "transition") : undefined);
    // A Choice is used only when Grown reads its effect (reveal, morph, or a
    // classic one with a p14:dur); otherwise the Fallback.
    const choice = branches.find((b) => {
      if (b.localName !== "Choice") return false;
      if (!(b.getAttribute("Requires") ?? "").split(/\s+/).every((r) => r === "p14" || r === "p159")) return false;
      const fx = pick(b)?.firstElementChild?.localName;
      return !fx || KNOWN_FX.has(fx);
    });
    const tr = pick(choice) ?? pick(branches.find((b) => b.localName === "Fallback"));
    if (tr) return tr;
  }
  return null;
}

/** Insert a transition (from transitionXml) into a slide part after
 *  `p:clrMapOvr` (or `p:cSld`), replacing any existing one. ECMA-376
 *  orders `<p:sld>` children cSld, clrMapOvr, transition, timing, extLst. */
export function insertTransition(slideXml: string, xml: string): string {
  const s = slideXml
    .replace(/<mc:AlternateContent\b[^>]*>(?:(?!<\/mc:AlternateContent>)[\s\S])*?<p:transition\b[\s\S]*?<\/mc:AlternateContent>/, "")
    .replace(/<p:transition\b(?:[^>]*\/>|[\s\S]*?<\/p:transition>)/, "");
  if (!xml) return s;
  for (const re of [/<\/p:clrMapOvr>|<p:clrMapOvr\/>/, /<\/p:cSld>|<p:cSld\/>/]) {
    const m = re.exec(s);
    if (m) {
      const at = m.index + m[0].length;
      return s.slice(0, at) + xml + s.slice(at);
    }
  }
  return s;
}

/** Insert `p:timing` after the transition (or clrMapOvr / cSld),
 *  replacing any existing one. */
export function insertTiming(slideXml: string, xml: string): string {
  const s = slideXml.replace(/<p:timing\b(?:[^>]*\/>|[\s\S]*?<\/p:timing>)/, "");
  if (!xml) return s;
  const anchors = [/<\/mc:AlternateContent>/g, /<\/p:transition>|<p:transition\b[^>]*\/>/g, /<\/p:clrMapOvr>|<p:clrMapOvr\/>/g, /<\/p:cSld>|<p:cSld\/>/g];
  for (const re of anchors) {
    let last: RegExpExecArray | null = null;
    for (let m = re.exec(s); m; m = re.exec(s)) last = m;
    if (last && (re !== anchors[0] || /<p:transition\b/.test(s.slice(0, last.index)))) {
      const at = last.index + last[0].length;
      return s.slice(0, at) + xml + s.slice(at);
    }
  }
  return s;
}

// ------------------------------------------------------------ timing: write

const DIR_SUBTYPE: Record<string, number> = { t: 1, r: 2, b: 4, l: 8 };
const SUBTYPE_DIR: Record<number, AnimEffect["dir"]> = { 1: "t", 2: "r", 4: "b", 8: "l" };
const WIPE_FILTER: Record<string, string> = { b: "wipe(up)", t: "wipe(down)", l: "wipe(right)", r: "wipe(left)" };

function presetOf(e: AnimEffect): { id: number; sub: number } {
  const sub = DIR_SUBTYPE[e.dir ?? "b"] ?? 4;
  switch (e.kind) {
    case "appear":
      return { id: 1, sub: 0 };
    case "fade":
      return { id: 10, sub: 0 };
    case "fly":
      return { id: 2, sub };
    case "float":
      return e.dir === "t" ? { id: 47, sub: 0 } : e.dir === "l" || e.dir === "r" ? { id: 42, sub } : { id: 42, sub: 0 };
    case "wipe":
      return { id: 22, sub };
    case "zoom":
      return { id: 53, sub: 16 };
    case "grow":
      return { id: 6, sub: 0 };
    case "spin":
      return { id: 8, sub: 0 };
    case "pulse":
      return { id: 26, sub: 0 };
    case "colorPulse":
      return { id: 27, sub: 0 };
    case "teeter":
      return { id: 32, sub: 0 };
  }
}

const hex = (c: string | undefined) => (c ?? "#ffb300").replace(/^#/, "").toUpperCase().padEnd(6, "0").slice(0, 6);

/**
 * The `p:timing` for a slide's animations, or "" when it has none that can
 * be written. `spid` maps element ids to their `cNvPr@id` in the slide
 * part; effects on elements without one (group members, skipped elements)
 * are left out.
 */
export function timingXml(slide: Slide, spid: Map<string, string>): string {
  if (!effectsOf(slide).length) return "";
  const t = buildTimeline(slide);
  let id = 2;
  const nid = () => ++id;
  const elOf = (i: string) => slide.elements.find((e) => e.id === i);
  const tgt = (te: TimedEffect) => {
    const sp = spid.get(te.effect.el)!;
    const tx = te.para !== undefined ? `<p:txEl><p:pRg st="${te.para}" end="${te.para}"/></p:txEl>` : "";
    return `<p:tgtEl><p:spTgt spid="${sp}">${tx}</p:spTgt></p:tgtEl>`;
  };
  const clickPars: string[] = [];
  const built = new Map<string, boolean>();
  t.groups.forEach((g, gi) => {
    const items = g.filter((te) => spid.has(te.effect.el));
    if (!items.length) return;
    // Sub-pars: each click/after effect opens one; with-effects join it.
    const subs: { at: number; items: TimedEffect[] }[] = [];
    for (const te of items) {
      if (!subs.length || te.start !== "with") subs.push({ at: te.begin - Math.max(0, te.effect.delay ?? 0), items: [] });
      subs[subs.length - 1].items.push(te);
    }
    const subXml = subs.map((sp) => {
      const effects = sp.items.map((te) => {
        const e = te.effect;
        const el = elOf(e.el);
        if (el?.type === "text") built.set(spid.get(e.el)!, built.get(spid.get(e.el)!) || te.para !== undefined);
        const { id: pid, sub } = presetOf(e);
        const node = te.start === "click" ? "clickEffect" : te.start === "with" ? "withEffect" : "afterEffect";
        const d = Math.max(1, te.end - te.begin);
        const T = tgt(te);
        const set = (vis: "visible" | "hidden", delay: number) =>
          `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${T}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${vis}"/></p:to></p:set>`;
        const fx = (tr: "in" | "out", filter: string) =>
          `<p:animEffect transition="${tr}" filter="${filter}"><p:cBhvr><p:cTn id="${nid()}" dur="${d}"/>${T}</p:cBhvr></p:animEffect>`;
        const anim = (attr: string, from: string, to: string) =>
          `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="${d}" fill="hold"/>${T}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
        const offX = e.dir === "l" ? "0-#ppt_w/2" : e.dir === "r" ? "1+#ppt_w/2" : "#ppt_x";
        const offY = e.dir === "t" ? "0-#ppt_h/2" : e.dir === "b" || !e.dir ? "1+#ppt_h/2" : "#ppt_y";
        const nudge = (axis: "x" | "y") => {
          const sign = axis === "y" ? (e.dir === "t" ? "-" : "+") : e.dir === "l" ? "-" : "+";
          return `#ppt_${axis}${sign}.1`;
        };
        const floatAxis = e.dir === "l" || e.dir === "r" ? "x" : "y";
        let kids = "";
        if (e.cls === "entr") {
          kids = set("visible", 0);
          if (e.kind === "fade") kids += fx("in", "fade");
          else if (e.kind === "fly") kids += anim("ppt_x", offX, "#ppt_x") + anim("ppt_y", offY, "#ppt_y");
          else if (e.kind === "float") kids += fx("in", "fade") + anim(`ppt_${floatAxis}`, nudge(floatAxis), `#ppt_${floatAxis}`);
          else if (e.kind === "wipe") kids += fx("in", WIPE_FILTER[e.dir ?? "b"]);
          else if (e.kind === "zoom") kids += anim("ppt_w", "0", "#ppt_w") + anim("ppt_h", "0", "#ppt_h") + fx("in", "fade");
        } else if (e.cls === "exit") {
          if (e.kind === "fade") kids = fx("out", "fade");
          else if (e.kind === "fly") kids = anim("ppt_x", "#ppt_x", offX) + anim("ppt_y", "#ppt_y", offY);
          else if (e.kind === "float") kids = fx("out", "fade") + anim(`ppt_${floatAxis}`, `#ppt_${floatAxis}`, nudge(floatAxis));
          else if (e.kind === "wipe") kids = fx("out", WIPE_FILTER[e.dir ?? "b"]);
          else if (e.kind === "zoom") kids = anim("ppt_w", "#ppt_w", "0") + anim("ppt_h", "#ppt_h", "0") + fx("out", "fade");
          kids += set("hidden", e.kind === "appear" ? 0 : d - 1);
        } else {
          const beh = (inner: string, extra = "") => `<p:cBhvr><p:cTn id="${nid()}" ${extra}/>${T}${inner}</p:cBhvr>`;
          if (e.kind === "grow") {
            const v = Math.round((e.scale ?? 1.5) * 100000);
            kids = `<p:animScale>${beh("", `dur="${d}" fill="hold"`)}<p:by x="${v}" y="${v}"/></p:animScale>`;
          } else if (e.kind === "pulse")
            kids = `<p:animScale>${beh("", `dur="${Math.max(1, Math.round(d / 2))}" autoRev="1" fill="hold"`)}<p:by x="108000" y="108000"/></p:animScale>`;
          else if (e.kind === "spin")
            kids = `<p:animRot by="${Math.round((e.angle ?? 360) * 60000)}">${beh(
              "<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst>",
              `dur="${d}" fill="hold"`,
            )}</p:animRot>`;
          else if (e.kind === "teeter")
            kids = `<p:animRot by="240000">${beh(
              "<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst>",
              `dur="${Math.max(1, Math.round(d / 4))}" autoRev="1" repeatCount="2000" fill="hold"`,
            )}</p:animRot>`;
          else if (e.kind === "colorPulse")
            kids = `<p:animClr clrSpc="hsl" dir="cw"><p:cBhvr override="childStyle"><p:cTn id="${nid()}" dur="${Math.max(1, Math.round(d / 2))}" autoRev="1" fill="remove"/>${T}<p:attrNameLst><p:attrName>fillcolor</p:attrName></p:attrNameLst></p:cBhvr><p:to><a:srgbClr val="${hex(e.color)}"/></p:to></p:animClr>`;
        }
        return `<p:par><p:cTn id="${nid()}" presetID="${pid}" presetClass="${e.cls}" presetSubtype="${sub}" fill="hold" grpId="0" nodeType="${node}"><p:stCondLst><p:cond delay="${Math.max(0, e.delay ?? 0)}"/></p:stCondLst><p:childTnLst>${kids}</p:childTnLst></p:cTn></p:par>`;
      });
      return `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="${Math.max(0, Math.round(sp.at))}"/></p:stCondLst><p:childTnLst>${effects.join("")}</p:childTnLst></p:cTn></p:par>`;
    });
    const auto = gi === 0 ? `<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>` : "";
    clickPars.push(
      `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>${auto}</p:stCondLst><p:childTnLst>${subXml.join("")}</p:childTnLst></p:cTn></p:par>`,
    );
  });
  if (!clickPars.length) return "";
  const bld = [...built].map(([sp, byPara]) => `<p:bldP spid="${sp}" grpId="0"${byPara ? ` build="p"` : ""}/>`).join("");
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clickPars.join("")}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst>${bld ? `<p:bldLst>${bld}</p:bldLst>` : ""}</p:timing>`
  );
}

// ------------------------------------------------------------ timing: read

function kidsNamed(el: Element | null | undefined, name: string): Element[] {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : [];
}
function kidNamed(el: Element | null | undefined, name: string): Element | undefined {
  return kidsNamed(el, name)[0];
}
function descNamed(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", name));
}
function numAttr(el: Element | null | undefined, a: string): number | undefined {
  const v = el?.getAttribute(a);
  if (v === null || v === undefined || v === "" || v === "indefinite") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function condDelay(cTn: Element | undefined): number {
  const c = kidNamed(kidNamed(cTn, "stCondLst"), "cond");
  return numAttr(c, "delay") ?? 0;
}

function kindOf(cls: string, id: number, sub: number): { kind: AnimKind; dir?: AnimEffect["dir"]; exact: boolean } {
  if (cls === "emph") {
    const m: Record<number, AnimKind> = { 26: "pulse", 27: "colorPulse", 32: "teeter", 8: "spin", 6: "grow" };
    return m[id] ? { kind: m[id], exact: true } : { kind: "pulse", exact: false };
  }
  switch (id) {
    case 1:
      return { kind: "appear", exact: true };
    case 10:
      return { kind: "fade", exact: true };
    case 2:
      return { kind: "fly", dir: SUBTYPE_DIR[sub] ?? "b", exact: true };
    case 42:
      return { kind: "float", dir: sub === 2 || sub === 8 ? SUBTYPE_DIR[sub] : "b", exact: true };
    case 47:
      return { kind: "float", dir: "t", exact: true };
    case 30:
      return { kind: "float", dir: "b", exact: false };
    case 22:
      return { kind: "wipe", dir: SUBTYPE_DIR[sub] ?? "b", exact: true };
    case 53:
    case 23:
      return { kind: "zoom", exact: id === 53 };
    default:
      return { kind: "fade", exact: false };
  }
}

/** The span of an effect's behaviours, ms (delay + duration, doubled for
 *  auto-reverse, times the repeat count). */
function effectSpan(eff: Element): number {
  let end = 0;
  for (const c of descNamed(eff, "cTn")) {
    if (c === eff) continue;
    const dur = numAttr(c, "dur");
    if (dur === undefined) continue;
    const rep = (numAttr(c, "repeatCount") ?? 1000) / 1000;
    const rev = c.getAttribute("autoRev") === "1" || c.getAttribute("autoRev") === "true" ? 2 : 1;
    end = Math.max(end, condDelay(c) + dur * rev * rep);
  }
  return Math.round(end);
}

export interface ReadTimingResult {
  anims: AnimEffect[];
  /** Some effects were approximated (motion paths, other presets). */
  simplified: boolean;
}

/**
 * Read a slide's main animation sequence into Grown effects. `spids` maps
 * a shape's `cNvPr@id` to the Grown elements read from it (a shape with
 * text can become two). Consecutive paragraph effects of one shape become
 * one by-paragraph effect. Motion paths, media and interactive (trigger)
 * sequences are skipped.
 */
export function readTiming(root: Element, spids: Map<string, string[]>, makeId: () => string): ReadTimingResult {
  const res: ReadTimingResult = { anims: [], simplified: false };
  const timing = kidNamed(root, "timing") ?? descNamed(root, "timing")[0];
  if (!timing) return res;
  const main = descNamed(timing, "cTn").find((c) => c.getAttribute("nodeType") === "mainSeq");
  if (!main) {
    if (descNamed(timing, "cTn").some((c) => c.getAttribute("presetClass"))) res.simplified = true;
    return res;
  }
  if (descNamed(timing, "cTn").some((c) => c.getAttribute("nodeType") === "interactiveSeq")) res.simplified = true;
  type Raw = { cls: AnimEffect["cls"]; kind: AnimKind; dir?: AnimEffect["dir"]; start: AnimStart; delay: number; dur: number; spid: string; para?: number; extra: Partial<AnimEffect> };
  const raws: Raw[] = [];
  const clickPars = kidsNamed(kidNamed(main, "childTnLst"), "par");
  clickPars.forEach((cp, ci) => {
    const subs = kidsNamed(kidNamed(kidNamed(cp, "cTn"), "childTnLst"), "par");
    let first = true;
    subs.forEach((sp, si) => {
      const effs = kidsNamed(kidNamed(kidNamed(sp, "cTn"), "childTnLst"), "par");
      effs.forEach((ep, ei) => {
        const cTn = kidNamed(ep, "cTn");
        if (!cTn) return;
        const cls = cTn.getAttribute("presetClass");
        if (cls !== "entr" && cls !== "exit" && cls !== "emph") {
          res.simplified = true;
          return;
        }
        const spTgt = descNamed(cTn, "spTgt")[0];
        const sp = spTgt?.getAttribute("spid");
        if (!sp || !spids.has(sp)) return;
        const pRg = descNamed(spTgt, "pRg")[0];
        const para = numAttr(pRg, "st");
        const k = kindOf(cls, numAttr(cTn, "presetID") ?? 0, numAttr(cTn, "presetSubtype") ?? 0);
        if (!k.exact) res.simplified = true;
        const node = cTn.getAttribute("nodeType");
        let start: AnimStart =
          node === "clickEffect" ? "click" : node === "withEffect" ? "with" : node === "afterEffect" ? "after" : ei > 0 ? "with" : si > 0 ? "after" : "click";
        if (first && ci === 0 && start === "click" && kidsNamed(kidNamed(kidNamed(cp, "cTn"), "stCondLst"), "cond").some((c) => c.getAttribute("evt") === "onBegin"))
          start = "after";
        first = false;
        const extra: Partial<AnimEffect> = {};
        if (k.kind === "grow") {
          const by = descNamed(cTn, "by")[0];
          const x = numAttr(by, "x");
          if (x !== undefined) extra.scale = Math.round(x / 1000) / 100;
        }
        if (k.kind === "spin") {
          const by = numAttr(descNamed(cTn, "animRot")[0], "by");
          if (by !== undefined && by !== 21600000) extra.angle = Math.round(by / 60000);
        }
        if (k.kind === "colorPulse") {
          const c = descNamed(cTn, "srgbClr")[0]?.getAttribute("val");
          if (c) extra.color = `#${c.toLowerCase()}`;
        }
        raws.push({ cls, kind: k.kind, dir: k.dir, start, delay: condDelay(cTn), dur: effectSpan(cTn), spid: sp, para, extra });
      });
    });
  });
  // Merge consecutive paragraph effects of one shape into a by-paragraph effect.
  const merged: (Raw & { byPara?: boolean })[] = [];
  for (const r of raws) {
    const prev = merged[merged.length - 1];
    if (
      r.para !== undefined &&
      prev?.byPara &&
      prev.spid === r.spid &&
      prev.cls === r.cls &&
      prev.kind === r.kind &&
      prev.para !== undefined &&
      r.para > prev.para &&
      (r.start === (prev.start === "click" ? "click" : "after") || r.start === "after")
    ) {
      prev.para = r.para;
      continue;
    }
    merged.push(r.para !== undefined ? { ...r, byPara: true } : r);
  }
  for (const r of merged) {
    const els = spids.get(r.spid)!;
    els.forEach((el, i) => {
      res.anims.push({
        id: makeId(),
        el,
        cls: r.cls,
        kind: r.kind,
        start: i === 0 ? r.start : "with",
        ...(r.delay ? { delay: r.delay } : {}),
        ...(r.dur && r.dur !== kindDef(r.cls, r.kind)?.dur ? { dur: r.dur } : {}),
        ...(r.dir ? { dir: r.dir } : {}),
        ...(r.byPara && els.length === 1 ? { byPara: true } : {}),
        ...r.extra,
      });
    });
  }
  return res;
}
