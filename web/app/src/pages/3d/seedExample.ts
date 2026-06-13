/**
 * Default seeded example model for the 3D app's Model Library.
 *
 * A brand-new user's Drive has no /models folder and nothing to look at, which
 * makes the 3D app feel empty on first run. To give the library something to
 * view (and a starting point to open in the editor), we seed a small procedural
 * spaceship — "Example Ship.glb" — into /models the first time the library is
 * opened.
 *
 * The ship is built from three.js primitives and exported to a binary glTF in
 * the browser, so there's no static asset to ship or host. Seeding is guarded by
 * a localStorage flag so we never fight a user who deletes the example: once
 * seeded (or once we detect it already exists) we don't recreate it.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { uploadFile } from "../drive/api";
import type { DriveFile } from "../drive/types";

/** File name of the seeded example, matched case-insensitively for de-dup. */
export const EXAMPLE_SHIP_NAME = "Example Ship.glb";

/** localStorage flag: set once we've seeded (or found) the example, so a user
 *  who deletes it isn't handed it back on the next visit. */
const SEEDED_KEY = "grown.3d.seededExampleShip";

function alreadySeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether we've already seeded (or detected) the example. Lets the library
 *  decide whether to auto-create a missing /models folder on first run. */
export function hasSeededExample(): boolean {
  return alreadySeeded();
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    /* ignore (private mode, etc.) — worst case we re-check existence next time */
  }
}

/**
 * Build a small low-poly spaceship as a THREE.Group. The ship points down +Z
 * (nose forward) and rests just above the grid. Each mesh is tagged editable so
 * it's directly selectable if the model is opened in the editor.
 */
export function buildExampleShip(): THREE.Group {
  const ship = new THREE.Group();
  ship.name = "Example Ship";

  const hull = new THREE.MeshStandardMaterial({
    color: 0x9fb3c8,
    metalness: 0.2,
    roughness: 0.6,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0xe8553a,
    metalness: 0.1,
    roughness: 0.7,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x6b7280,
    metalness: 0.9,
    roughness: 0.3,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x5ad1ff,
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.45,
  });

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    name: string,
    pos: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.name = name;
    mesh.userData.editable = true;
    ship.add(mesh);
    return mesh;
  };

  // Fuselage: cylindrical body with a nose cone (forward, +Z) and a tail cone.
  const body = new THREE.CylinderGeometry(0.3, 0.3, 1.0, 20);
  body.rotateX(Math.PI / 2); // long axis → Z
  add(body, hull, "Fuselage", [0, 0, 0]);

  const nose = new THREE.ConeGeometry(0.3, 0.8, 20);
  nose.rotateX(Math.PI / 2); // apex → +Z
  add(nose, hull, "Nose", [0, 0, 0.9]);

  const tail = new THREE.ConeGeometry(0.3, 0.5, 20);
  tail.rotateX(-Math.PI / 2); // apex → -Z
  add(tail, hull, "Tail", [0, 0, -0.75]);

  // Main delta wings: one thin swept slab spanning X, accent-colored.
  const wings = new THREE.BoxGeometry(1.9, 0.06, 0.6);
  add(wings, accent, "Wings", [0, -0.05, -0.1]);

  // Vertical tail fin.
  const fin = new THREE.BoxGeometry(0.06, 0.45, 0.4);
  add(fin, accent, "Fin", [0, 0.28, -0.55]);

  // Cockpit canopy: a glassy half-sphere up front.
  const canopy = new THREE.SphereGeometry(0.2, 20, 16);
  add(canopy, glass, "Canopy", [0, 0.2, 0.32]);

  // Twin engine nacelles at the rear, metal.
  const engineGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.5, 16);
  engineGeo.rotateX(Math.PI / 2);
  add(engineGeo, metal, "Engine L", [-0.28, -0.05, -0.6]);
  add(engineGeo.clone(), metal, "Engine R", [0.28, -0.05, -0.6]);

  // Float the whole ship above the grid so it reads as a model, not a footprint.
  ship.position.y = 0.55;
  return ship;
}

/** Build the example ship and export it as a binary glTF (.glb) ArrayBuffer. */
export async function buildExampleShipGLB(): Promise<ArrayBuffer> {
  const ship = buildExampleShip();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(ship, { binary: true });
  return result as ArrayBuffer;
}

/**
 * Seed the example ship into the given /models folder if it isn't there already.
 *
 * `existingNames` are the current file names in /models (any depth is fine — we
 * just want to avoid a duplicate). Returns the new DriveFile if we uploaded one,
 * or null if seeding was skipped (already present, already seeded once, or the
 * upload failed — seeding is best-effort and must never block the library).
 */
export async function seedExampleShipIfNeeded(
  folderId: string,
  existingNames: string[],
): Promise<DriveFile | null> {
  const present = existingNames.some(
    (n) => n.toLowerCase() === EXAMPLE_SHIP_NAME.toLowerCase(),
  );
  if (present) {
    markSeeded();
    return null;
  }
  if (alreadySeeded()) return null;

  try {
    const bytes = await buildExampleShipGLB();
    const file = new File([bytes], EXAMPLE_SHIP_NAME, {
      type: "model/gltf-binary",
    });
    const uploaded = await uploadFile(file, folderId);
    markSeeded();
    return uploaded;
  } catch {
    // Best-effort: a failed seed shouldn't surface an error in the gallery.
    return null;
  }
}
