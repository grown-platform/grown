/**
 * Supported 3D model formats for the viewer + Drive picker filter.
 *
 * The viewer currently renders the formats with a real loader (see Viewer.ts).
 * The broader list is used to *filter* the Drive picker so the user only sees
 * candidate model files; unsupported-but-listed formats surface a friendly
 * "not yet supported" error rather than silently failing.
 */

/** Extensions the embedded three.js viewer can actually render today. */
export const RENDERABLE_EXTS = [
  "glb",
  "gltf",
  "obj",
  "stl",
  "ply",
] as const;

/** Companion/asset extensions shown in the picker (loaded alongside a model). */
export const COMPANION_EXTS = ["bin", "mtl"] as const;

/**
 * The full set of 3D extensions the picker offers. Some (fbx, 3ds, dae, off,
 * 3mf, wrl) are recognized as models but not yet wired to a loader — see the
 * TODO in Viewer.ts. They are listed so the picker is forward-compatible.
 */
export const MODEL_EXTS = [
  ...RENDERABLE_EXTS,
  "fbx",
  "3ds",
  "dae",
  "off",
  "3mf",
  "wrl",
] as const;

/** Picker-visible extensions = models + their companion assets. */
export const PICKER_EXTS = [...MODEL_EXTS, ...COMPANION_EXTS];

/** Lowercase file extension without the dot, or "" if none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** True if the file name looks like a 3D model the picker should surface. */
export function isModelFile(name: string): boolean {
  const e = extOf(name);
  return (PICKER_EXTS as readonly string[]).includes(e);
}

/** True if the embedded viewer has a loader for this file today. */
export function isRenderable(name: string): boolean {
  const e = extOf(name);
  return (RENDERABLE_EXTS as readonly string[]).includes(e);
}
