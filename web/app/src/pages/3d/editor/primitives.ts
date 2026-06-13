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

/**
 * On-plane 2D face factories. These build flat faces that lie on the ground
 * plane (y=0), driven by the drawing tools (Rectangle/Circle/Polygon). Geometry
 * is authored in the XZ plane (rotated flat) and the mesh is positioned at the
 * face's center on the ground. Each face is tagged `userData.editable` (and a
 * `userData.primitive` of "rect"/"circle"/"polygon") so it behaves exactly like
 * a primitive afterward — selectable, movable, paintable.
 *
 * The default number of segments for circles matches SketchUp's 24-sided circle.
 */
export const CIRCLE_SEGMENTS = 24;

/** A flat double-sided face material, sharing the primitive default look. */
function faceMaterial(): THREE.MeshStandardMaterial {
  const m = makeMaterial("matte", DEFAULT_COLOR);
  m.side = THREE.DoubleSide;
  return m;
}

/** Lay a face geometry flat (authored in XY) onto the ground (XZ) plane. */
function layFlat(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  geom.rotateX(-Math.PI / 2);
  return geom;
}

/**
 * Build a rectangular ground face spanning two opposite corners (world XZ).
 * The mesh is centered between the corners and rests on y=0.
 */
export function createRectFace(
  a: THREE.Vector3,
  b: THREE.Vector3,
): THREE.Mesh {
  const width = Math.max(Math.abs(b.x - a.x), 1e-3);
  const depth = Math.max(Math.abs(b.z - a.z), 1e-3);
  const geom = layFlat(new THREE.PlaneGeometry(width, depth));
  const mesh = new THREE.Mesh(geom, faceMaterial());
  mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  mesh.name = `Rectangle ${++counter}`;
  mesh.userData.editable = true;
  mesh.userData.primitive = "rect";
  return mesh;
}

/**
 * Build a circular ground face from a center point and a rim point (world XZ).
 * `sides` controls the segment count (24 for circles, 3+ for polygons).
 */
export function createDiskFace(
  center: THREE.Vector3,
  rim: THREE.Vector3,
  sides: number,
  kind: "circle" | "polygon",
): THREE.Mesh {
  const radius = Math.max(center.distanceTo(rim), 1e-3);
  const geom = layFlat(new THREE.CircleGeometry(radius, Math.max(3, sides)));
  const mesh = new THREE.Mesh(geom, faceMaterial());
  mesh.position.set(center.x, 0, center.z);
  mesh.name = `${kind === "circle" ? "Circle" : "Polygon"} ${++counter}`;
  mesh.userData.editable = true;
  mesh.userData.primitive = kind;
  return mesh;
}
