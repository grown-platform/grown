/**
 * Save/Export helpers for the editor. The editor exports its scene to a binary
 * glTF (.glb) ArrayBuffer (Editor.exportGLB); these helpers turn that into a
 * Drive upload (into the /models folder, reusing the Drive upload API) or a
 * local download.
 */
import { listFiles, createFolder, uploadFile } from "../../drive/api";
import { isFolder, type DriveFile } from "../../drive/types";

/** Find (or create) the user's root-level "models" folder. */
async function resolveModelsFolder(): Promise<DriveFile> {
  const root = await listFiles("");
  const existing = root.find(
    (f) => isFolder(f) && f.name.toLowerCase() === "models",
  );
  if (existing) return existing;
  return createFolder("models", "");
}

/** Ensure the name ends with .glb. */
function withGlbExt(name: string): string {
  const trimmed = name.trim() || "model";
  return /\.glb$/i.test(trimmed) ? trimmed : `${trimmed}.glb`;
}

/** Upload the glb bytes to Drive's /models folder. Returns the new DriveFile. */
export async function saveGlbToDrive(
  bytes: ArrayBuffer,
  name: string,
): Promise<DriveFile> {
  const folder = await resolveModelsFolder();
  const fileName = withGlbExt(name);
  const file = new File([bytes], fileName, { type: "model/gltf-binary" });
  return uploadFile(file, folder.id);
}

/** Trigger a local download of the glb bytes. */
export function downloadGlb(bytes: ArrayBuffer, name: string): void {
  const blob = new Blob([bytes], { type: "model/gltf-binary" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = withGlbExt(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
