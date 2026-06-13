/**
 * ModelViewer — a thin, framework-agnostic three.js scene wrapper.
 *
 * Why three.js (not online-3d-viewer): three.js + its example loaders integrate
 * cleanly with Vite + TS (ESM imports, ships its own types via @types/three),
 * and give us direct control over the grid/ground, orbit controls, and the
 * fit-to-view math we need as the seed of a future SketchUp-style editor. The
 * online-3d-viewer npm build pulls a heavier all-in-one canvas that is harder
 * to extend toward editing.
 *
 * The class owns a renderer + scene + camera + OrbitControls and exposes:
 *   - newScene(): clear to an empty grid (the "New model" canvas)
 *   - loadModel(bytes, ext, name): parse + display a model, then fit-to-view
 *   - fitToView(): frame the current model
 *   - resize() / dispose(): lifecycle
 *
 * TODO(editor): this is intentionally a *viewer*. The next step toward a
 * modeler is to add an edit mode here (selectable meshes, transform gizmos,
 * face/edge picking, push/pull) on top of this same scene graph.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

export type Projection = "perspective" | "orthographic";

export class ModelViewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  /** The active render camera — swapped between perspective and ortho. */
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** The persistent perspective camera (kept so we can swap back losslessly). */
  private perspCamera: THREE.PerspectiveCamera;
  /** The persistent orthographic camera. */
  private orthoCamera: THREE.OrthographicCamera;
  private projection: Projection = "perspective";
  private controls: OrbitControls;
  /** The currently-loaded model root (everything under here is cleared on reload). */
  private modelRoot: THREE.Group | null = null;
  private grid: THREE.GridHelper;
  private frameId = 0;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  /** Listeners notified when the active camera object is swapped (ortho↔persp),
   *  so layered tools (Editor) can re-target their controls/raycaster. */
  private cameraListeners = new Set<
    (cam: THREE.PerspectiveCamera | THREE.OrthographicCamera) => void
  >();

  /**
   * Accessors so a layered editor (Editor.ts) can reach the scene graph,
   * camera, renderer and controls without us leaking these everywhere. The
   * viewer stays the owner of lifecycle; the editor only borrows references.
   */
  getScene(): THREE.Scene {
    return this.scene;
  }
  getCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.camera;
  }
  /** Subscribe to active-camera swaps (ortho↔perspective). Returns unsubscribe. */
  onCameraChange(
    fn: (cam: THREE.PerspectiveCamera | THREE.OrthographicCamera) => void,
  ): () => void {
    this.cameraListeners.add(fn);
    return () => this.cameraListeners.delete(fn);
  }
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }
  getControls(): OrbitControls {
    return this.controls;
  }
  getGrid(): THREE.GridHelper {
    return this.grid;
  }
  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
  getContainer(): HTMLElement {
    return this.container;
  }
  /** The root group holding the current model, if any (editor adds into the scene directly). */
  getModelRoot(): THREE.Group | null {
    return this.modelRoot;
  }

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f5f7);

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const aspect = w / h;
    this.perspCamera = new THREE.PerspectiveCamera(50, aspect, 0.01, 10000);
    this.perspCamera.position.set(6, 5, 8);
    // The ortho camera shares the near/far envelope; its frustum half-height is
    // derived on every swap from the perspective distance so framing matches.
    this.orthoCamera = new THREE.OrthographicCamera(
      -aspect,
      aspect,
      1,
      -1,
      0.01,
      10000,
    );
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.camera = this.perspCamera;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    // Enable per-material clipping planes so the Section Plane tool can cut the
    // model non-destructively (vs. global renderer.clippingPlanes).
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Lighting: a soft ambient + a key directional + hemisphere for fill.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(5, 10, 7);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.5));

    // Ground grid — the blank modeling canvas reference plane.
    this.grid = new THREE.GridHelper(40, 40, 0x9aa0a6, 0xd0d4d8);
    this.scene.add(this.grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  /** Clear any loaded model and return to an empty grid canvas ("New model"). */
  newScene(): void {
    this.clearModel();
    this.camera.position.set(6, 5, 8);
    this.controls.target.set(0, 0, 0);
    if (this.projection === "orthographic") {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const vFov = (this.perspCamera.fov * Math.PI) / 180;
      this.applyOrthoFrustum(Math.tan(vFov / 2) * dist);
    }
    this.controls.update();
  }

  // ---- Camera projection / FOV ----

  getProjection(): Projection {
    return this.projection;
  }

  getFov(): number {
    return this.perspCamera.fov;
  }

  /** Adjust the perspective field-of-view (no-op visually in ortho mode). */
  setFov(fov: number): void {
    const clamped = THREE.MathUtils.clamp(fov, 10, 120);
    this.perspCamera.fov = clamped;
    this.perspCamera.updateProjectionMatrix();
  }

  /** Swap between perspective and orthographic projection, preserving framing. */
  setProjection(projection: Projection): void {
    if (projection === this.projection) return;
    this.projection = projection;

    const from = this.camera;
    const to =
      projection === "orthographic" ? this.orthoCamera : this.perspCamera;

    // Preserve eye position and look direction across the swap.
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);

    if (projection === "orthographic") {
      // Match the perspective frustum at the orbit target: the ortho half-height
      // is the perspective half-height at the current view distance.
      const dist = from.position.distanceTo(this.controls.target);
      const vFov = (this.perspCamera.fov * Math.PI) / 180;
      const halfH = Math.tan(vFov / 2) * dist;
      this.applyOrthoFrustum(halfH);
    }

    this.camera = to;
    this.controls.object = to;
    this.controls.update();
    for (const fn of this.cameraListeners) fn(to);
  }

  /** Size the ortho frustum from a half-height, honoring the viewport aspect. */
  private applyOrthoFrustum(halfH: number): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    const halfW = halfH * aspect;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  private clearModel(): void {
    if (!this.modelRoot) return;
    this.scene.remove(this.modelRoot);
    this.modelRoot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.modelRoot = null;
  }

  /**
   * Load a model from raw bytes. `ext` is the lowercase extension (no dot).
   * Throws on an unsupported extension or a parse failure.
   */
  async loadModel(
    bytes: ArrayBuffer,
    ext: string,
    name: string,
  ): Promise<void> {
    const root = await this.parse(bytes, ext, name);
    this.clearModel();
    root.name = name;
    this.modelRoot = root;
    this.scene.add(root);
    this.fitToView();
  }

  private async parse(
    bytes: ArrayBuffer,
    ext: string,
    name: string,
  ): Promise<THREE.Group> {
    switch (ext) {
      case "glb":
      case "gltf": {
        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(bytes, "");
        return gltf.scene as unknown as THREE.Group;
      }
      case "obj": {
        const text = new TextDecoder().decode(bytes);
        const obj = new OBJLoader().parse(text);
        return obj;
      }
      case "stl": {
        const geom = new STLLoader().parse(bytes);
        return this.meshFromGeometry(geom);
      }
      case "ply": {
        const geom = new PLYLoader().parse(bytes);
        geom.computeVertexNormals();
        return this.meshFromGeometry(geom);
      }
      default:
        // TODO(formats): wire FBXLoader / 3DS / Collada (DAE) / 3MF / VRML(wrl).
        // Three.js ships example loaders for several of these; OFF needs a
        // small custom parser. Until then we surface a clear error.
        throw new Error(
          `The .${ext} format ("${name}") isn't supported by the viewer yet.`,
        );
    }
  }

  /** Wrap a bare BufferGeometry (STL/PLY) in a default-material mesh + group. */
  private meshFromGeometry(geom: THREE.BufferGeometry): THREE.Group {
    const material = new THREE.MeshStandardMaterial({
      color: 0xb0b4ba,
      metalness: 0.1,
      roughness: 0.7,
      flatShading: false,
    });
    const mesh = new THREE.Mesh(geom, material);
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  /** Frame the current model (or reset framing if the scene is empty). */
  fitToView(): void {
    if (!this.modelRoot) {
      this.camera.position.set(6, 5, 8);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      return;
    }
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Use the perspective FOV to compute a framing distance for both cameras.
    const fov = (this.perspCamera.fov * Math.PI) / 180;
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6;

    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    // Keep both cameras' clipping envelope generous enough for this framing.
    this.perspCamera.near = dist / 100;
    this.perspCamera.far = dist * 100;
    this.perspCamera.updateProjectionMatrix();
    if (this.projection === "orthographic") {
      this.applyOrthoFrustum((maxDim / 2) * 1.6);
    }
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.update();

    // Sit the grid just under the model's lowest point.
    this.grid.position.y = box.min.y;
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    if (this.projection === "orthographic") {
      // Preserve the current vertical extent, re-derive width from aspect.
      this.applyOrthoFrustum(this.orthoCamera.top);
    }
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
