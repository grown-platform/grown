/**
 * SectionPlane — a non-destructive clipping plane for the editor, mirroring
 * SketchUp's Section Plane tool. It pairs a visible, movable plane gizmo (a
 * translucent quad + outline + normal arrow) with a `THREE.Plane` that is fed
 * into every editable material's `clippingPlanes`. Toggling the section off (or
 * disposing) removes the clipping and restores the full model.
 *
 * The Editor owns lifecycle and decides which meshes are clipped; this class
 * just produces the gizmo + the live `THREE.Plane` and keeps them in sync as the
 * gizmo moves (it's driven by the editor's TransformControls, so it benefits
 * from the same translate gizmo + snap the rest of the editor uses).
 *
 * Note: clipping only cuts faces, it doesn't cap the exposed hollow (SketchUp's
 * "Section Fills" — the stencil-cap technique — is a deferred follow-up).
 */
import * as THREE from "three";

export class SectionPlane {
  /** The gizmo group the editor adds to the scene and attaches transforms to. */
  readonly object: THREE.Group;
  /** The live clipping plane applied to material.clippingPlanes. */
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** Local-space normal of the gizmo quad (before the group's transform). */
  private localNormal = new THREE.Vector3(0, 1, 0);
  /** +1 / -1 — which side the plane keeps; flipped by reverse(). */
  private flip = 1;

  private quad: THREE.Mesh;
  private arrow: THREE.ArrowHelper;

  constructor(size = 8) {
    this.object = new THREE.Group();
    this.object.name = "__section_plane";

    // A translucent quad showing the cut plane. Authored in XZ (lying flat) so
    // its local normal is +Y; the group transform orients/positions it.
    const quadGeom = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.quad = new THREE.Mesh(
      quadGeom,
      new THREE.MeshBasicMaterial({
        color: 0x1976d2,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.object.add(this.quad);

    // A border so the plane reads clearly even when nearly edge-on.
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(quadGeom),
      new THREE.LineBasicMaterial({ color: 0x1976d2 }),
    );
    this.object.add(border);

    // A normal arrow indicating the kept side of the cut.
    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      size * 0.35,
      0x1976d2,
      size * 0.12,
      size * 0.07,
    );
    this.object.add(this.arrow);

    this.update();
  }

  /** Recompute the THREE.Plane from the gizmo's current world transform. */
  update(): void {
    this.object.updateMatrixWorld(true);
    const worldNormal = this.localNormal
      .clone()
      .transformDirection(this.object.matrixWorld)
      .multiplyScalar(this.flip)
      .normalize();
    const worldPos = new THREE.Vector3().setFromMatrixPosition(
      this.object.matrixWorld,
    );
    this.plane.setFromNormalAndCoplanarPoint(worldNormal, worldPos);
    // Point the arrow along the kept side (the plane's normal points away from
    // the clipped half-space).
    this.arrow.setDirection(
      this.localNormal.clone().multiplyScalar(this.flip).normalize(),
    );
  }

  /** Flip which side of the plane is cut away. */
  reverse(): void {
    this.flip *= -1;
    this.update();
  }

  dispose(): void {
    this.object.removeFromParent();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.object.traverse((o) => {
      const line = o as THREE.LineSegments;
      if (line.isLineSegments) {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    });
    this.arrow.dispose();
  }
}
