/**
 * Material presets for the Paint tool. Each preset produces a fresh
 * MeshStandardMaterial so painted objects don't share (and accidentally
 * co-mutate) a material instance. Color is applied on top of the preset.
 */
import * as THREE from "three";

export type MaterialPreset = "matte" | "metal" | "glass";

export const MATERIAL_PRESETS: { id: MaterialPreset; label: string }[] = [
  { id: "matte", label: "Matte" },
  { id: "metal", label: "Metal" },
  { id: "glass", label: "Glass" },
];

/** Default color for freshly-added primitives. */
export const DEFAULT_COLOR = 0xb9c0c9;

export function makeMaterial(
  preset: MaterialPreset,
  color: THREE.ColorRepresentation,
): THREE.MeshStandardMaterial {
  switch (preset) {
    case "metal":
      return new THREE.MeshStandardMaterial({
        color,
        metalness: 0.9,
        roughness: 0.25,
      });
    case "glass":
      return new THREE.MeshStandardMaterial({
        color,
        metalness: 0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.4,
      });
    case "matte":
    default:
      return new THREE.MeshStandardMaterial({
        color,
        metalness: 0.05,
        roughness: 0.85,
      });
  }
}

/** Best-effort read of an object's current color as a hex string for the UI. */
export function colorHexOf(obj: THREE.Object3D | null): string {
  if (!obj) return "#b9c0c9";
  const mesh = obj as THREE.Mesh;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const c = (mat as THREE.MeshStandardMaterial | undefined)?.color;
  return c ? `#${c.getHexString()}` : "#b9c0c9";
}
