/**
 * ThumbnailRenderer — renders small preview thumbnails of 3D models entirely
 * client-side with a SINGLE shared offscreen three.js renderer.
 *
 * Memory + performance strategy (see the library grid for why this matters when
 * there could be dozens/hundreds of models):
 *   - ONE shared WebGLRenderer (default 256×256), reused across every thumbnail.
 *     We never spin up a renderer per card — WebGL contexts are scarce.
 *   - A small SEQUENTIAL queue: only one model is parsed + held in memory at a
 *     time. As soon as we snapshot a model to a data URL we dispose its
 *     geometry/material and remove it from the scene, so peak memory is ~one
 *     model, not the whole library.
 *   - The framing math mirrors ModelViewer.fitToView so previews match the
 *     viewer's composition.
 *   - Two-tier CACHE keyed by `${fileId}:${updatedAt}` so a model re-renders
 *     only when its content changes: an in-memory Map (instant within a
 *     session) backed by localStorage (instant across reloads). Data URLs are
 *     small (256×256 JPEG-ish PNG), and we cap the persisted cache size.
 *
 * Only RENDERABLE_EXTS (glb/gltf/obj/stl/ply) are rendered; other formats fall
 * back to a format-icon placeholder in the UI (we never enqueue them).
 *
 * TODO(follow-up): a server-side thumbnail cache (render once on upload, store
 * the PNG in Drive metadata / a sibling blob) would remove all client-side
 * rendering cost and let the public gallery show previews without auth.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { isRenderable } from "./formats";

const THUMB_SIZE = 256;
const LS_PREFIX = "grown.3d.thumb.";
/** Cap the number of persisted thumbnails so localStorage can't grow unbounded. */
const LS_MAX_ENTRIES = 120;

/** In-memory cache keyed by `${fileId}:${updatedAt}` → data URL. */
const memCache = new Map<string, string>();

function cacheKey(fileId: string, updatedAt: string): string {
  return `${fileId}:${updatedAt}`;
}

/** Read a previously-persisted thumbnail (localStorage), if present. */
function readPersisted(key: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

/** Persist a thumbnail, evicting the oldest entries if we're over the cap. */
function writePersisted(key: string, dataURL: string): void {
  try {
    const fullKey = LS_PREFIX + key;
    localStorage.setItem(fullKey, dataURL);
    // Evict oldest-ish (by insertion order of keys) if over the cap.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) keys.push(k);
    }
    if (keys.length > LS_MAX_ENTRIES) {
      const toRemove = keys.slice(0, keys.length - LS_MAX_ENTRIES);
      for (const k of toRemove) {
        if (k !== fullKey) localStorage.removeItem(k);
      }
    }
  } catch {
    // Quota exceeded or storage unavailable — thumbnails just won't persist.
  }
}

/** Look up a cached thumbnail (memory first, then localStorage). */
export function getCachedThumbnail(
  fileId: string,
  updatedAt: string,
): string | null {
  const key = cacheKey(fileId, updatedAt);
  const mem = memCache.get(key);
  if (mem) return mem;
  const persisted = readPersisted(key);
  if (persisted) {
    memCache.set(key, persisted);
    return persisted;
  }
  return null;
}

interface QueueItem {
  fileId: string;
  updatedAt: string;
  ext: string;
  name: string;
  fetchBytes: () => Promise<ArrayBuffer>;
  resolve: (dataURL: string) => void;
  reject: (err: Error) => void;
}

/**
 * A lazily-constructed singleton that owns the shared renderer + scene and
 * drains a sequential queue of thumbnail requests.
 */
class ThumbnailEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private queue: QueueItem[] = [];
  private draining = false;

  private ensureGL(): {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
  } {
    if (this.renderer && this.scene && this.camera) {
      return { renderer: this.renderer, scene: this.scene, camera: this.camera };
    }
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // required for toDataURL()
    });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_SIZE, THUMB_SIZE);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f5f7);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(5, 10, 7);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.5));

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    return { renderer, scene, camera };
  }

  enqueue(item: Omit<QueueItem, "resolve" | "reject">): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ ...item, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        const key = cacheKey(item.fileId, item.updatedAt);
        // A concurrent request may have already produced this thumbnail.
        const cached = memCache.get(key) ?? readPersisted(key);
        if (cached) {
          memCache.set(key, cached);
          item.resolve(cached);
          continue;
        }
        try {
          const bytes = await item.fetchBytes();
          const dataURL = await this.renderOne(bytes, item.ext, item.name);
          memCache.set(key, dataURL);
          writePersisted(key, dataURL);
          item.resolve(dataURL);
        } catch (e) {
          item.reject(e as Error);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Parse → frame → render → snapshot → dispose. Holds one model at a time. */
  private async renderOne(
    bytes: ArrayBuffer,
    ext: string,
    name: string,
  ): Promise<string> {
    const { renderer, scene, camera } = this.ensureGL();
    const root = await parseModel(bytes, ext, name);
    scene.add(root);
    try {
      frameObject(camera, root);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    } finally {
      // Free the model immediately so peak memory stays at ~one model.
      scene.remove(root);
      disposeObject(root);
    }
  }
}

const engine = new ThumbnailEngine();

/**
 * Request a thumbnail data URL for a renderable model. Resolves from cache when
 * possible, otherwise enqueues a sequential render. Rejects for unsupported
 * formats or parse/render failures (callers fall back to a placeholder).
 */
export async function requestThumbnail(opts: {
  fileId: string;
  updatedAt: string;
  name: string;
  fetchBytes: () => Promise<ArrayBuffer>;
}): Promise<string> {
  const ext = extLower(opts.name);
  if (!isRenderable(opts.name)) {
    throw new Error(`Format .${ext} is not renderable for thumbnails.`);
  }
  const cached = getCachedThumbnail(opts.fileId, opts.updatedAt);
  if (cached) return cached;
  return engine.enqueue({
    fileId: opts.fileId,
    updatedAt: opts.updatedAt,
    ext,
    name: opts.name,
    fetchBytes: opts.fetchBytes,
  });
}

function extLower(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Parse raw bytes into a Group — mirrors ModelViewer.parse's loaders. */
async function parseModel(
  bytes: ArrayBuffer,
  ext: string,
  name: string,
): Promise<THREE.Object3D> {
  switch (ext) {
    case "glb":
    case "gltf": {
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(bytes, "");
      return gltf.scene as unknown as THREE.Object3D;
    }
    case "obj": {
      const text = new TextDecoder().decode(bytes);
      return new OBJLoader().parse(text);
    }
    case "stl": {
      const geom = new STLLoader().parse(bytes);
      return meshFromGeometry(geom);
    }
    case "ply": {
      const geom = new PLYLoader().parse(bytes);
      geom.computeVertexNormals();
      return meshFromGeometry(geom);
    }
    default:
      throw new Error(`No thumbnail loader for .${ext} ("${name}").`);
  }
}

function meshFromGeometry(geom: THREE.BufferGeometry): THREE.Object3D {
  const material = new THREE.MeshStandardMaterial({
    color: 0xb0b4ba,
    metalness: 0.1,
    roughness: 0.7,
  });
  const mesh = new THREE.Mesh(geom, material);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

/** Position the camera to frame an object — mirrors ModelViewer.fitToView. */
function frameObject(camera: THREE.PerspectiveCamera, obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  const fov = (camera.fov * Math.PI) / 180;
  const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6;

  const dir = new THREE.Vector3(1, 0.8, 1).normalize();
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

/** Recursively dispose geometry + materials of a parsed model. */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
