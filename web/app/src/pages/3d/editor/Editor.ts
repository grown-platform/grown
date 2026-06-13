/**
 * Editor — the SketchUp-style modeling layer, built on top of ModelViewer's
 * three.js scene. The Viewer stays the owner of the renderer/scene/camera/
 * controls lifecycle; the Editor borrows references and adds:
 *
 *   - a tool mode (select / move / rotate / scale / primitives / pushpull /
 *     paint / erase / measure)
 *   - raycast selection + a selection outline highlight
 *   - TransformControls gizmo (translate/rotate/scale) with grid snapping
 *   - primitive creation (box/plane/cylinder/sphere)
 *   - basic Push/Pull on box-like meshes (scale + reposition along a face normal)
 *   - paint (material/color), erase/delete, tape measure
 *   - an undo/redo History covering all of the above
 *   - glTF (.glb) export of the editable geometry
 *
 * ARCHITECTURE NOTE: push/pull here is a box-face approximation (it scales the
 * mesh along the picked face's axis and re-anchors the opposite face). True
 * SketchUp push/pull on arbitrary faces of arbitrary solids is a CAD-kernel
 * operation — the follow-up is to back this with OpenCascade.js (B-rep solids +
 * STEP I/O) and replace the approximation with a real extrude on a planar face.
 *
 * The class is framework-agnostic (no React); the React layer subscribes to it
 * for UI state (active tool, selection name/transform/color, hint, undo state).
 */
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ModelViewer } from "../Viewer";
import { History, command } from "./commands";
import {
  createPrimitive,
  createRectFace,
  createDiskFace,
  CIRCLE_SEGMENTS,
  type PrimitiveKind,
} from "./primitives";
import {
  makeMaterial,
  colorHexOf,
  type MaterialPreset,
} from "./materials";
import { SectionPlane } from "./section";

export type Tool =
  | "select"
  | "move"
  | "rotate"
  | "scale"
  | "pushpull"
  | "paint"
  | "erase"
  | "measure"
  | "rect"
  | "circle"
  | "polygon";

/** A snapshot of the selected object's state, surfaced to the properties UI. */
export interface SelectionInfo {
  name: string;
  position: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  colorHex: string;
}

/** Reactive state the React layer renders from. */
export interface EditorState {
  tool: Tool;
  snap: boolean;
  selection: SelectionInfo | null;
  hint: string;
  canUndo: boolean;
  canRedo: boolean;
  measureDistance: number | null;
  /** Whether a section (clipping) plane is currently active. */
  sectionActive: boolean;
}

const SNAP_TRANSLATE = 0.25;
const SNAP_ROTATE = THREE.MathUtils.degToRad(15);
const SNAP_SCALE = 0.1;

const TOOL_HINTS: Record<Tool, string> = {
  select: "Select: click an object to select it. Click empty space to deselect.",
  move: "Move: drag the gizmo arrows. Hold the snap toggle to snap to the grid.",
  rotate: "Rotate: drag the gizmo rings. Snap rotates in 15° steps.",
  scale: "Scale: drag the gizmo handles to resize the selected object.",
  pushpull:
    "Push/Pull: select a box, then drag a face along its normal to extrude/inset it.",
  paint: "Paint: pick a color/material below, then click an object to paint it.",
  erase: "Erase: click an object to delete it (or press Delete).",
  measure: "Tape: click two points on geometry to measure the distance.",
  rect: "Rectangle: click-drag two opposite corners on the ground to draw a face.",
  circle: "Circle: click the center on the ground, then drag out the radius.",
  polygon: "Polygon: click the center on the ground, then drag out the radius.",
};

/** Sides used for the Polygon draw tool (regular hexagon by default). */
const POLYGON_SIDES = 6;

export class Editor {
  private viewer: ModelViewer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private dom: HTMLCanvasElement;
  /** Unsubscribe from the viewer's camera-swap notifications. */
  private offCameraChange: () => void;

  private transform: TransformControls;
  private transformHelper: THREE.Object3D;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  /** The XZ ground plane (y=0) the drawing tools raycast against. */
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // On-plane draw state (rect/circle/polygon): the first click anchors a start
  // point; dragging/clicking a second point builds the face. A live preview
  // mesh tracks the pointer until the gesture completes.
  private drawStart: THREE.Vector3 | null = null;
  private drawPreview: THREE.Mesh | null = null;
  /** Screen position of the draw-gesture's first pointerdown (drag vs click). */
  private drawDownXY: { x: number; y: number } | null = null;

  // Section (clipping) plane state.
  private section: SectionPlane | null = null;

  private selected: THREE.Mesh | null = null;
  private outline: THREE.LineSegments | null = null;

  private tool: Tool = "select";
  private snap = true;
  private paintPreset: MaterialPreset = "matte";
  private paintColor = "#6750a4";

  private history = new History();
  private listeners = new Set<(s: EditorState) => void>();

  // Tape-measure state.
  private measureA: THREE.Vector3 | null = null;
  private measureDistance: number | null = null;
  private measureLine: THREE.Line | null = null;

  // Push/pull drag state.
  private pulling: {
    mesh: THREE.Mesh;
    axis: "x" | "y" | "z";
    sign: number;
    startScale: number;
    startPos: number;
    grabWorld: number;
    baseSize: number;
  } | null = null;

  constructor(viewer: ModelViewer) {
    this.viewer = viewer;
    this.scene = viewer.getScene();
    this.camera = viewer.getCamera();
    this.dom = viewer.getDomElement();

    // TransformControls (three 0.169): the controls object dispatches events;
    // its visual helper is a separate Object3D you add to the scene.
    this.transform = new TransformControls(this.camera, this.dom);
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.applySnap();

    // Don't let the orbit camera fight the gizmo while dragging it.
    this.transform.addEventListener("dragging-changed", (e) => {
      this.viewer.getControls().enabled = !(e as { value: boolean }).value;
    });
    // Snapshot before/after a gizmo drag for a single undo step.
    this.transform.addEventListener("mouseDown", () => this.beginTransform());
    this.transform.addEventListener("mouseUp", () => this.endTransform());
    this.transform.addEventListener("objectChange", () => {
      // Keep the section plane's clip equation in sync with its gizmo.
      if (this.section && this.transform.object === this.section.object) {
        this.section.update();
      }
      this.emit();
    });

    this.dom.addEventListener("pointerdown", this.onPointerDown);
    this.dom.addEventListener("pointermove", this.onPointerMove);
    this.dom.addEventListener("pointerup", this.onPointerUp);

    // When the viewer swaps perspective↔orthographic, re-target our camera ref
    // and the gizmo's camera so picking and transforms stay correct.
    this.offCameraChange = this.viewer.onCameraChange((cam) => {
      this.camera = cam;
      this.transform.camera = cam;
    });

    this.history.subscribe(() => this.emit());
  }

  // ---- Public API (called from React) ----

  setTool(tool: Tool): void {
    this.tool = tool;
    // Map the transform-style tools onto the gizmo; detach for non-gizmo tools.
    if (tool === "move" || tool === "rotate" || tool === "scale") {
      this.transform.mode =
        tool === "move" ? "translate" : tool === "rotate" ? "rotate" : "scale";
      if (this.selected) this.transform.attach(this.selected);
    } else {
      this.transform.detach();
    }
    this.clearMeasure();
    this.cancelDraw();
    this.emit();
  }

  getTool(): Tool {
    return this.tool;
  }

  setSnap(on: boolean): void {
    this.snap = on;
    this.applySnap();
    this.emit();
  }

  setPaint(preset: MaterialPreset, colorHex: string): void {
    this.paintPreset = preset;
    this.paintColor = colorHex;
    this.emit();
  }

  /** Apply the current paint preset/color to the selected object (undoable). */
  paintSelected(): void {
    if (this.selected) this.applyPaint(this.selected);
  }

  addPrimitive(kind: PrimitiveKind): void {
    const mesh = createPrimitive(kind);
    this.addMesh(mesh, `Add ${kind}`);
  }

  /** Add a mesh to the scene as an undoable command, then select it. Applies
   *  the active section clip so new geometry is cut consistently. */
  private addMesh(mesh: THREE.Mesh, label: string): void {
    if (this.section) {
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat))
        mat.forEach((m) => (m.clippingPlanes = [this.section!.plane]));
      else mat.clippingPlanes = [this.section.plane];
    }
    this.history.run(
      command(
        label,
        () => this.scene.add(mesh),
        () => {
          if (this.selected === mesh) this.deselect();
          this.scene.remove(mesh);
        },
      ),
    );
    this.select(mesh);
  }

  // ---- Section plane (clipping) ----

  /** Whether a section plane is currently active. */
  isSectionActive(): boolean {
    return this.section !== null;
  }

  /** Toggle the section (clipping) plane on/off. Non-destructive. */
  toggleSection(): void {
    if (this.section) this.removeSection();
    else this.addSection();
    this.emit();
  }

  /** Flip which side of the active section plane is cut away. */
  reverseSection(): void {
    if (!this.section) return;
    this.section.reverse();
    this.applyClipping();
    this.emit();
  }

  private addSection(): void {
    // Size the plane to span the current scene, and place it through the middle.
    const box = new THREE.Box3();
    for (const m of this.editableMeshes()) box.expandByObject(m);
    let size = 8;
    const center = new THREE.Vector3(0, 0, 0);
    if (!box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3());
      size = Math.max(s.x, s.y, s.z) * 1.4 || 8;
      box.getCenter(center);
    }
    const section = new SectionPlane(size);
    section.object.position.copy(center);
    section.update();
    this.scene.add(section.object);
    this.section = section;
    this.applyClipping();
    // Attach the translate gizmo so the plane is immediately positionable.
    this.transform.mode = "translate";
    this.transform.attach(section.object);
  }

  private removeSection(): void {
    if (!this.section) return;
    if (this.transform.object === this.section.object) this.transform.detach();
    this.section.dispose();
    this.section = null;
    this.applyClipping();
    // Restore the gizmo to the selected mesh if a transform tool is active.
    if (
      this.selected &&
      (this.tool === "move" || this.tool === "rotate" || this.tool === "scale")
    ) {
      this.transform.attach(this.selected);
    }
  }

  /** Push the active section plane (or none) into every editable material. */
  private applyClipping(): void {
    const planes = this.section ? [this.section.plane] : [];
    for (const mesh of this.editableMeshes()) {
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => (m.clippingPlanes = planes));
      else mat.clippingPlanes = planes;
    }
  }

  deleteSelected(): void {
    const mesh = this.selected;
    if (!mesh) return;
    this.deselect();
    this.history.run(
      command(
        `Delete ${mesh.name}`,
        () => this.scene.remove(mesh),
        () => this.scene.add(mesh),
      ),
    );
  }

  undo(): void {
    this.transform.detach();
    this.history.undo();
    this.refreshSelectionFromScene();
  }
  redo(): void {
    this.transform.detach();
    this.history.redo();
    this.refreshSelectionFromScene();
  }

  /** Export the editable scene geometry as a binary glTF (.glb). */
  async exportGLB(): Promise<ArrayBuffer> {
    // Export a clean group of just the editable meshes + any loaded model root,
    // excluding the grid, gizmo, lights, outline and measure helpers.
    const exportRoot = new THREE.Group();
    const picked: THREE.Object3D[] = [];
    for (const child of this.scene.children) {
      if (child === this.transformHelper) continue;
      if (child === this.outline || child === this.measureLine) continue;
      if (this.section && child === this.section.object) continue;
      if (child === this.drawPreview) continue;
      if (child.type === "GridHelper") continue;
      if ((child as THREE.Light).isLight) continue;
      picked.push(child);
    }
    // Clone so we can group without disturbing the live scene.
    for (const o of picked) exportRoot.add(o.clone(true));

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(exportRoot, { binary: true });
    return result as ArrayBuffer;
  }

  subscribe(fn: (s: EditorState) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    this.dom.removeEventListener("pointermove", this.onPointerMove);
    this.dom.removeEventListener("pointerup", this.onPointerUp);
    this.offCameraChange();
    this.transform.detach();
    this.scene.remove(this.transformHelper);
    this.transform.dispose();
    this.clearOutline();
    this.clearMeasure();
    this.cancelDraw();
    // Removing the section also strips clippingPlanes from materials, restoring
    // the full model when the user leaves edit mode.
    this.removeSection();
  }

  // ---- Selection ----

  private select(mesh: THREE.Mesh): void {
    this.selected = mesh;
    this.drawOutline(mesh);
    if (this.tool === "move" || this.tool === "rotate" || this.tool === "scale") {
      this.transform.attach(mesh);
    }
    this.emit();
  }

  private deselect(): void {
    this.selected = null;
    this.transform.detach();
    this.clearOutline();
    this.emit();
  }

  /** After undo/redo, re-sync the gizmo/outline if the selected mesh still exists. */
  private refreshSelectionFromScene(): void {
    if (this.selected && !this.selected.parent) {
      // The selected mesh was removed by an undo/redo.
      this.selected = null;
      this.clearOutline();
    } else if (this.selected) {
      this.drawOutline(this.selected);
      if (
        this.tool === "move" ||
        this.tool === "rotate" ||
        this.tool === "scale"
      ) {
        this.transform.attach(this.selected);
      }
    }
    this.emit();
  }

  private drawOutline(mesh: THREE.Mesh): void {
    this.clearOutline();
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xff8c00, depthTest: false }),
    );
    line.renderOrder = 999;
    line.name = "__editor_outline";
    mesh.add(line);
    this.outline = line;
  }

  private clearOutline(): void {
    if (this.outline) {
      this.outline.geometry.dispose();
      (this.outline.material as THREE.Material).dispose();
      this.outline.removeFromParent();
      this.outline = null;
    }
  }

  // ---- Transform (gizmo) undo capture ----

  private transformBefore: {
    p: THREE.Vector3;
    q: THREE.Quaternion;
    s: THREE.Vector3;
  } | null = null;

  private beginTransform(): void {
    const m = this.selected;
    if (!m) return;
    this.transformBefore = {
      p: m.position.clone(),
      q: m.quaternion.clone(),
      s: m.scale.clone(),
    };
  }

  private endTransform(): void {
    const m = this.selected;
    const before = this.transformBefore;
    this.transformBefore = null;
    if (!m || !before) return;
    const after = {
      p: m.position.clone(),
      q: m.quaternion.clone(),
      s: m.scale.clone(),
    };
    // No-op drags shouldn't pollute history.
    if (
      before.p.equals(after.p) &&
      before.q.equals(after.q) &&
      before.s.equals(after.s)
    ) {
      return;
    }
    this.history.pushApplied(
      command(
        "Transform",
        () => {
          m.position.copy(after.p);
          m.quaternion.copy(after.q);
          m.scale.copy(after.s);
        },
        () => {
          m.position.copy(before.p);
          m.quaternion.copy(before.q);
          m.scale.copy(before.s);
        },
      ),
    );
  }

  private applySnap(): void {
    this.transform.translationSnap = this.snap ? SNAP_TRANSLATE : null;
    this.transform.rotationSnap = this.snap ? SNAP_ROTATE : null;
    this.transform.setScaleSnap(this.snap ? SNAP_SCALE : null);
  }

  // ---- Paint ----

  private applyPaint(mesh: THREE.Mesh): void {
    const prev = mesh.material as THREE.Material | THREE.Material[];
    const next = makeMaterial(this.paintPreset, this.paintColor);
    this.history.run(
      command(
        "Paint",
        () => {
          mesh.material = next;
        },
        () => {
          mesh.material = prev;
        },
      ),
    );
    if (this.selected === mesh) this.emit();
  }

  // ---- Tape measure ----

  private clearMeasure(): void {
    this.measureA = null;
    if (this.measureLine) {
      this.measureLine.geometry.dispose();
      (this.measureLine.material as THREE.Material).dispose();
      this.scene.remove(this.measureLine);
      this.measureLine = null;
    }
  }

  private handleMeasure(point: THREE.Vector3): void {
    if (!this.measureA) {
      this.measureA = point.clone();
      this.measureDistance = null;
    } else {
      const a = this.measureA;
      this.measureDistance = a.distanceTo(point);
      const geom = new THREE.BufferGeometry().setFromPoints([a, point.clone()]);
      if (this.measureLine) {
        this.measureLine.geometry.dispose();
        this.measureLine.geometry = geom;
      } else {
        this.measureLine = new THREE.Line(
          geom,
          new THREE.LineBasicMaterial({ color: 0x1976d2, depthTest: false }),
        );
        this.measureLine.renderOrder = 998;
        this.scene.add(this.measureLine);
      }
      this.measureA = null; // next click starts a fresh measurement
    }
    this.emit();
  }

  // ---- On-plane drawing (Rectangle / Circle / Polygon) ----
  //
  // All three tools raycast the cursor onto the ground plane (y=0). Rectangle
  // takes two opposite corners; Circle/Polygon take a center then a rim point.
  // Either click-click or click-drag-release completes the gesture. A live
  // preview mesh tracks the cursor between the two points.

  /** Raycast the current pointer ray onto the y=0 ground plane. */
  private pointOnGround(): THREE.Vector3 | null {
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    if (this.snap) {
      hit.x = Math.round(hit.x / SNAP_TRANSLATE) * SNAP_TRANSLATE;
      hit.z = Math.round(hit.z / SNAP_TRANSLATE) * SNAP_TRANSLATE;
    }
    return hit;
  }

  /** Build the face mesh for the active draw tool from start→current points. */
  private buildDrawMesh(
    start: THREE.Vector3,
    end: THREE.Vector3,
  ): THREE.Mesh | null {
    if (this.tool === "rect") {
      if (Math.abs(end.x - start.x) < 1e-3 || Math.abs(end.z - start.z) < 1e-3)
        return null;
      return createRectFace(start, end);
    }
    if (this.tool === "circle" || this.tool === "polygon") {
      if (start.distanceTo(end) < 1e-3) return null;
      const sides = this.tool === "circle" ? CIRCLE_SEGMENTS : POLYGON_SIDES;
      return createDiskFace(start, end, sides, this.tool);
    }
    return null;
  }

  /** First point of a draw gesture (the corner or center). */
  private startDraw(): void {
    const p = this.pointOnGround();
    if (!p) return;
    this.drawStart = p;
  }

  /** Update the live preview as the cursor moves after the first point. */
  private updateDrawPreview(): void {
    if (!this.drawStart) return;
    const end = this.pointOnGround();
    if (!end) return;
    const mesh = this.buildDrawMesh(this.drawStart, end);
    this.clearDrawPreview();
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0.5;
    this.drawPreview = mesh;
    this.scene.add(mesh);
  }

  /** Commit the draw gesture into a real, undoable, selectable face. */
  private finishDraw(): void {
    if (!this.drawStart) return;
    const end = this.pointOnGround();
    const start = this.drawStart;
    this.cancelDraw();
    if (!end) return;
    const mesh = this.buildDrawMesh(start, end);
    if (!mesh) return;
    const label =
      this.tool === "rect"
        ? "Draw rectangle"
        : this.tool === "circle"
          ? "Draw circle"
          : "Draw polygon";
    this.addMesh(mesh, label);
  }

  private clearDrawPreview(): void {
    if (this.drawPreview) {
      this.scene.remove(this.drawPreview);
      this.drawPreview.geometry.dispose();
      (this.drawPreview.material as THREE.Material).dispose();
      this.drawPreview = null;
    }
  }

  private cancelDraw(): void {
    this.drawStart = null;
    this.clearDrawPreview();
  }

  // ---- Pointer handling ----

  private updatePointer(e: PointerEvent): void {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** Editable meshes in the scene (excludes grid/gizmo/lights/helpers,
   *  the section-plane gizmo, and any in-progress draw preview). */
  private editableMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name === "__editor_outline") return;
      if (m === this.drawPreview) return;
      // Skip gizmo internals (they live under the transform helper) and the
      // section-plane gizmo (lives under the section group).
      let p: THREE.Object3D | null = m;
      while (p) {
        if (p === this.transformHelper) return;
        if (this.section && p === this.section.object) return;
        p = p.parent;
      }
      out.push(m);
    });
    return out;
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Left button only; let the gizmo + orbit controls own their drags.
    if (e.button !== 0) return;
    if ((this.transform as unknown as { dragging: boolean }).dragging) return;
    this.updatePointer(e);
    const hits = this.raycaster.intersectObjects(this.editableMeshes(), false);
    const hit = hits[0];

    switch (this.tool) {
      case "select":
      case "move":
      case "rotate":
      case "scale": {
        if (hit) this.select(hit.object as THREE.Mesh);
        else this.deselect();
        break;
      }
      case "paint": {
        if (hit) this.applyPaint(hit.object as THREE.Mesh);
        break;
      }
      case "erase": {
        if (hit) {
          this.select(hit.object as THREE.Mesh);
          this.deleteSelected();
        }
        break;
      }
      case "measure": {
        if (hit) this.handleMeasure(hit.point);
        break;
      }
      case "pushpull": {
        this.beginPushPull(hit);
        break;
      }
      case "rect":
      case "circle":
      case "polygon": {
        if (!this.drawStart) {
          // First point: anchor and freeze the orbit camera for the gesture.
          this.startDraw();
          this.drawDownXY = { x: e.clientX, y: e.clientY };
          if (this.drawStart) this.viewer.getControls().enabled = false;
        } else {
          // Second click completes a click-click gesture.
          this.viewer.getControls().enabled = true;
          this.finishDraw();
          this.drawDownXY = null;
        }
        break;
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.drawStart) {
      this.updatePointer(e);
      this.updateDrawPreview();
      return;
    }
    if (!this.pulling) return;
    this.updatePointer(e);
    this.updatePushPull();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.pulling) {
      this.endPushPull();
      return;
    }
    if (this.drawStart && this.drawDownXY) {
      // Drag-release: if the pointer moved past a small threshold from the
      // first point, treat it as a click-drag and commit. A near-stationary
      // release keeps the anchor so a second click can finish (click-click).
      const dx = e.clientX - this.drawDownXY.x;
      const dy = e.clientY - this.drawDownXY.y;
      if (Math.hypot(dx, dy) > 6) {
        this.viewer.getControls().enabled = true;
        this.updatePointer(e);
        this.finishDraw();
        this.drawDownXY = null;
      }
    }
  };

  // ---- Push / Pull (box-face approximation) ----
  //
  // For an axis-aligned box mesh, dragging a face along its normal is modelled
  // as: scale the mesh along that axis and shift it by half the delta so the
  // *opposite* face stays put — exactly the SketchUp push/pull feel for a box.
  // Arbitrary-face extrusion on general meshes is the OpenCascade.js follow-up.

  private beginPushPull(hit: THREE.Intersection | undefined): void {
    if (!hit || !hit.face) return;
    const mesh = hit.object as THREE.Mesh;
    if (mesh.userData.primitive !== "box") {
      // Only box push/pull is wired; select the mesh so the user gets feedback.
      this.select(mesh);
      return;
    }
    this.select(mesh);

    // Face normal in world space → dominant axis.
    const normal = hit.face.normal
      .clone()
      .transformDirection(mesh.matrixWorld)
      .normalize();
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    const axis: "x" | "y" | "z" =
      ax >= ay && ax >= az ? "x" : ay >= az ? "y" : "z";
    const sign = Math.sign(normal[axis]) || 1;

    // Base (unscaled) size of the box along this axis.
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const baseSize =
      axis === "x"
        ? bb.max.x - bb.min.x
        : axis === "y"
          ? bb.max.y - bb.min.y
          : bb.max.z - bb.min.z;

    this.viewer.getControls().enabled = false;
    this.pulling = {
      mesh,
      axis,
      sign,
      startScale: mesh.scale[axis],
      startPos: mesh.position[axis],
      grabWorld: hit.point[axis],
      baseSize,
    };
    // Capture undo baseline.
    this.beginTransform();
  }

  private updatePushPull(): void {
    const p = this.pulling;
    if (!p) return;
    // Intersect the ray with the plane through the grab point, perpendicular to
    // the most camera-facing of the two axes orthogonal to the drag axis. A
    // simple robust choice: use a plane whose normal is the camera direction
    // projected to be orthogonal to the drag axis.
    const dragDir = new THREE.Vector3();
    dragDir[p.axis] = 1;

    // Build a plane containing the drag axis, facing the camera as much as
    // possible, so the ray-plane intersection tracks the cursor along the axis.
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    let planeNormal = camDir
      .clone()
      .sub(dragDir.clone().multiplyScalar(camDir.dot(dragDir)));
    if (planeNormal.lengthSq() < 1e-6) planeNormal = new THREE.Vector3(0, 1, 0);
    planeNormal.normalize();

    const origin = new THREE.Vector3();
    origin[p.axis] = p.grabWorld;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      planeNormal,
      origin,
    );
    const target = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, target)) return;

    let delta = (target[p.axis] - p.grabWorld) * p.sign;
    if (this.snap) delta = Math.round(delta / SNAP_TRANSLATE) * SNAP_TRANSLATE;

    const newSize = Math.max(0.05, p.baseSize * p.startScale + delta);
    const newScale = newSize / p.baseSize;
    p.mesh.scale[p.axis] = newScale;
    // Re-anchor so the opposite face stays fixed: shift centre by half the size
    // change in the drag direction.
    const sizeChange = (newScale - p.startScale) * p.baseSize;
    p.mesh.position[p.axis] = p.startPos + (sizeChange / 2) * p.sign;

    if (this.selected === p.mesh) this.drawOutline(p.mesh);
    this.emit();
  }

  private endPushPull(): void {
    this.pulling = null;
    this.viewer.getControls().enabled = true;
    // Reuse the transform undo machinery (it diffs position/scale).
    this.endTransform();
  }

  // ---- State / events ----

  private snapshot(): EditorState {
    return {
      tool: this.tool,
      snap: this.snap,
      selection: this.selectionInfo(),
      hint: TOOL_HINTS[this.tool],
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      measureDistance: this.measureDistance,
      sectionActive: this.section !== null,
    };
  }

  private selectionInfo(): SelectionInfo | null {
    const m = this.selected;
    if (!m) return null;
    const e = new THREE.Euler().setFromQuaternion(m.quaternion);
    return {
      name: m.name || "(unnamed)",
      position: { x: m.position.x, y: m.position.y, z: m.position.z },
      rotationDeg: {
        x: THREE.MathUtils.radToDeg(e.x),
        y: THREE.MathUtils.radToDeg(e.y),
        z: THREE.MathUtils.radToDeg(e.z),
      },
      scale: { x: m.scale.x, y: m.scale.y, z: m.scale.z },
      colorHex: colorHexOf(m),
    };
  }

  private emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  // Expose current paint settings for the UI to reflect.
  getPaint(): { preset: MaterialPreset; color: string } {
    return { preset: this.paintPreset, color: this.paintColor };
  }
}
