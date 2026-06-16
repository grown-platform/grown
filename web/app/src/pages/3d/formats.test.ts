import { describe, it, expect } from "vitest";
import {
  RENDERABLE_EXTS,
  COMPANION_EXTS,
  MODEL_EXTS,
  PICKER_EXTS,
  extOf,
  isModelFile,
  isRenderable,
} from "./formats";

describe("3d/formats constants", () => {
  it("RENDERABLE_EXTS is the loader-backed set", () => {
    expect([...RENDERABLE_EXTS]).toEqual(["glb", "gltf", "obj", "stl", "ply"]);
  });

  it("COMPANION_EXTS are asset extensions", () => {
    expect([...COMPANION_EXTS]).toEqual(["bin", "mtl"]);
  });

  it("MODEL_EXTS is RENDERABLE_EXTS plus not-yet-wired formats", () => {
    expect([...MODEL_EXTS]).toEqual([
      "glb",
      "gltf",
      "obj",
      "stl",
      "ply",
      "fbx",
      "3ds",
      "dae",
      "off",
      "3mf",
      "wrl",
    ]);
  });

  it("PICKER_EXTS is models + companions", () => {
    expect(PICKER_EXTS).toEqual([...MODEL_EXTS, ...COMPANION_EXTS]);
  });

  it("every renderable ext is also a model ext", () => {
    for (const e of RENDERABLE_EXTS) {
      expect(MODEL_EXTS).toContain(e);
    }
  });
});

describe("extOf", () => {
  const cases: [string, string][] = [
    ["model.gltf", "gltf"],
    ["scene.GLB", "glb"], // lowercased
    ["a.b.c.OBJ", "obj"], // last dot wins, lowercased
    ["MODEL.StL", "stl"],
    ["noextension", ""], // no dot
    ["", ""], // empty
    ["trailingdot.", ""], // dot is last char
    [".gitignore", "gitignore"], // leading dot only
    ["path/to/file.ply", "ply"], // slashes preserved before ext
  ];

  it.each(cases)("extOf(%j) === %j", (name, expected) => {
    expect(extOf(name)).toBe(expected);
  });
});

describe("isModelFile", () => {
  const truthy = [
    "a.glb",
    "a.gltf",
    "a.obj",
    "a.stl",
    "a.ply",
    "a.fbx",
    "a.3ds",
    "a.dae",
    "a.off",
    "a.3mf",
    "a.wrl",
    "a.bin", // companion still counts as picker-visible
    "a.mtl",
    "SCENE.GLTF", // case-insensitive
  ];

  it.each(truthy)("isModelFile(%j) === true", (name) => {
    expect(isModelFile(name)).toBe(true);
  });

  const falsy = ["a.png", "a.txt", "noext", "", "a.", "a.zip"];

  it.each(falsy)("isModelFile(%j) === false", (name) => {
    expect(isModelFile(name)).toBe(false);
  });
});

describe("isRenderable", () => {
  const truthy = ["a.glb", "a.gltf", "a.obj", "a.stl", "a.ply", "A.GLB"];

  it.each(truthy)("isRenderable(%j) === true", (name) => {
    expect(isRenderable(name)).toBe(true);
  });

  const falsy = [
    "a.fbx", // model but not yet loader-backed
    "a.3ds",
    "a.dae",
    "a.bin", // companion, not renderable
    "a.mtl",
    "a.png",
    "noext",
    "",
  ];

  it.each(falsy)("isRenderable(%j) === false", (name) => {
    expect(isRenderable(name)).toBe(false);
  });

  it("renderable implies model file", () => {
    for (const e of RENDERABLE_EXTS) {
      expect(isModelFile(`x.${e}`)).toBe(true);
    }
  });
});
