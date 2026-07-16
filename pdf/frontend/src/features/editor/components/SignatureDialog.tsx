import { useRef, useState, useEffect } from "react";
import { Type, PenTool, Upload, X } from "lucide-react";

// A produced signature asset: a raster (transparent PNG, or an uploaded
// PNG/JPEG) plus its natural pixel size (so the editor can place it
// aspect-correct as an image annotation) and mime (so pdf-lib picks the right
// embed path on export).
export interface SigResult {
  dataUrl: string;
  w: number;
  h: number;
  mime: "image/png" | "image/jpeg";
}

type Tab = "type" | "draw" | "upload";

// Render typed text to a tightly-sized, TRANSPARENT PNG in a script-ish font so
// it overlays the document cleanly. Mirrors SignatureCanvas's type-mode canvas
// approach, but keeps the background transparent (no white fill).
function typeToPng(text: string): SigResult {
  const fontSize = 100;
  const font = `italic ${fontSize}px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Dancing Script", cursive`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textWidth = Math.max(measure.measureText(text).width, 120);
  const pad = 24;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textWidth + pad * 2);
  canvas.height = Math.ceil(fontSize * 1.6);
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.fillStyle = "#1e293b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return { dataUrl: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height, mime: "image/png" };
}

/**
 * "Create signature" dialog with Type / Draw / Upload tabs. On confirm it
 * yields a SigResult (a PNG/JPEG + natural size) that the editor drops as an
 * image annotation (reusing the existing image render + pdf-lib embed path).
 *
 * The Draw tab reuses SignatureCanvas's proven drawing approach (same
 * getCoordinates / start / move / stop pointer handlers) on a transparent
 * canvas, so drawn strokes overlay the document without a white box.
 */
export function SignatureDialog({
  kind,
  onConfirm,
  onCancel,
}: {
  kind: "signature" | "initials";
  onConfirm: (result: SigResult) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<Tab>("type");
  const [typed, setTyped] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [upload, setUpload] = useState<SigResult | null>(null);
  // Wave 9 — restore focus to whatever opened the dialog on close.
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const r = restoreRef.current;
      if (r && typeof r.focus === "function" && document.contains(r)) r.focus();
    };
  }, []);

  const label = kind === "initials" ? "Create initials" : "Create signature";

  // Prepare the draw canvas: transparent pixels + dark stroke style.
  useEffect(() => {
    if (tab !== "draw") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setHasDrawn(false);
  }, [tab]);

  const coords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const p = "touches" in e ? e.touches[0] : e;
    return { x: (p.clientX - rect.left) * sx, y: (p.clientY - rect.top) * sy };
  };
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = coords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };
  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = coords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };
  const stopDraw = () => {
    drawing.current = false;
  };
  const clearDraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const onUploadChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const mime: "image/png" | "image/jpeg" =
      file.type === "image/jpeg" || file.type === "image/jpg" ? "image/jpeg" : "image/png";
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => setUpload({ dataUrl, w: img.width || 300, h: img.height || 120, mime });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const canConfirm = tab === "type" ? typed.trim().length > 0 : tab === "draw" ? hasDrawn : !!upload;

  const confirm = () => {
    if (tab === "type") {
      if (!typed.trim()) return;
      onConfirm(typeToPng(typed.trim()));
    } else if (tab === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return;
      onConfirm({ dataUrl: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height, mime: "image/png" });
    } else if (upload) {
      onConfirm(upload);
    }
  };

  const tabBtn = (id: Tab, testId: string, icon: React.ReactNode, text: string) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => setTab(id)}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 transition-colors text-sm ${
        tab === id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 text-gray-600"
      }`}
    >
      {icon}
      {text}
    </button>
  );

  return (
    <div
      data-testid="sig-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sig-dialog-title"
        className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5 focus:outline-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="sig-dialog-title" className="text-lg font-semibold">{label}</h3>
          <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-gray-100" title="Close" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {tabBtn("type", "sig-tab-type", <Type className="w-4 h-4" />, "Type")}
          {tabBtn("draw", "sig-tab-draw", <PenTool className="w-4 h-4" />, "Draw")}
          {tabBtn("upload", "sig-tab-upload", <Upload className="w-4 h-4" />, "Upload")}
        </div>

        {tab === "type" && (
          <div>
            <input
              data-testid="sig-type-input"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={kind === "initials" ? "Your initials" : "Your full name"}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
            />
            <div className="border rounded-lg h-[110px] flex items-center justify-center overflow-hidden bg-gray-50">
              {typed ? (
                <span
                  className="text-gray-800 whitespace-nowrap px-4"
                  style={{
                    fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Dancing Script", cursive',
                    fontStyle: "italic",
                    fontSize: `clamp(24px, ${Math.max(72 - typed.length * 2, 30)}px, 72px)`,
                  }}
                >
                  {typed}
                </span>
              ) : (
                <span className="text-gray-400 text-sm">Preview appears here</span>
              )}
            </div>
          </div>
        )}

        {tab === "draw" && (
          <div>
            <p className="text-sm text-gray-500 mb-2">Draw with your mouse or finger.</p>
            <div className="border rounded-lg overflow-hidden mb-2 touch-none bg-gray-50">
              <canvas
                ref={canvasRef}
                width={450}
                height={180}
                className="w-full cursor-crosshair"
                onMouseDown={startDraw}
                onMouseMove={moveDraw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={moveDraw}
                onTouchEnd={stopDraw}
              />
            </div>
            <button type="button" onClick={clearDraw} className="text-sm text-gray-600 hover:text-gray-900">
              Clear
            </button>
          </div>
        )}

        {tab === "upload" && (
          <div>
            <label className="block border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400">
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <span className="text-sm text-gray-600">Choose a PNG or JPEG signature image</span>
              <input
                data-testid="sig-upload-input"
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={onUploadChosen}
              />
            </label>
            {upload && (
              <div className="mt-3 border rounded-lg p-2 flex items-center justify-center bg-gray-50 h-[110px]">
                <img src={upload.dataUrl} alt="signature preview" className="max-h-full max-w-full object-contain" />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button
            type="button"
            data-testid="sig-confirm"
            onClick={confirm}
            disabled={!canConfirm}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {kind === "initials" ? "Use initials" : "Use signature"}
          </button>
        </div>
      </div>
    </div>
  );
}
