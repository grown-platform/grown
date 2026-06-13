/**
 * Primitive mesh factory for the editor. Each primitive is a plain
 * THREE.Mesh with a fresh default material, sized to sit reasonably on the
 * ground grid (1 unit ≈ 1 in the grid's spacing). They are tagged via
 * userData.editable so the selection raycaster only picks user geometry (not
 * the grid, gizmo, or lights).
 */
import * as THREE from "three";
import { makeMaterial, DEFAULT_COLOR } from "./materials";

export type PrimitiveKind = "box" | "plane" | "cylinder" | "sphere";

let counter = 0;

export function createPrimitive(kind: PrimitiveKind): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  let yOffset = 0; // lift so the primitive rests on the grid (y=0 plane).

  switch (kind) {
    case "box":
      geometry = new THREE.BoxGeometry(1, 1, 1);
      yOffset = 0.5;
      break;
    case "plane":
      geometry = new THREE.PlaneGeometry(2, 2);
      // Lay the plane flat on the ground.
      geometry.rotateX(-Math.PI / 2);
      yOffset = 0;
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
      yOffset = 0.5;
      break;
    case "sphere":
      geometry = new THREE.SphereGeometry(0.5, 32, 24);
      yOffset = 0.5;
      break;
  }

  const material = makeMaterial("matte", DEFAULT_COLOR);
  if (kind === "plane") material.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = yOffset;
  mesh.name = `${kind[0].toUpperCase()}${kind.slice(1)} ${++counter}`;
  mesh.userData.editable = true;
  mesh.userData.primitive = kind;
  return mesh;
}
