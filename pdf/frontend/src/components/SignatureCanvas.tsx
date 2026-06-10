import { useRef, useEffect, useState } from "react";
import { PenTool, Type } from "lucide-react";

interface SignatureCanvasProps {
  onSave: (signatureData: string) => void;
  onCancel: () => void;
}

type SignatureMode = "draw" | "type";

export function SignatureCanvas({ onSave, onCancel }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [mode, setMode] = useState<SignatureMode>("draw");
  const [typedName, setTypedName] = useState("");
  const [acceptTyped, setAcceptTyped] = useState(false);

  // Initialize canvas for drawing mode
  useEffect(() => {
    if (mode !== "draw") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set up canvas
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Clear canvas with white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw signature line
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 40);
    ctx.lineTo(canvas.width - 20, canvas.height - 40);
    ctx.stroke();

    // Reset stroke style for signature
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
  }, [mode]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Redraw signature line
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 40);
    ctx.lineTo(canvas.width - 20, canvas.height - 40);
    ctx.stroke();

    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    setHasDrawn(false);
  };

  const handleSave = () => {
    if (mode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/png");
      onSave(dataUrl);
    } else {
      // Type mode - render text to canvas and export
      // First, measure the text to create a properly sized canvas
      const measureCanvas = document.createElement("canvas");
      const measureCtx = measureCanvas.getContext("2d");
      if (!measureCtx) return;

      // Use a large font size for measurement
      const fontSize = 100;
      measureCtx.font = `${fontSize}px "Dancing Script", "Brush Script MT", cursive`;
      const textMetrics = measureCtx.measureText(typedName);

      // Calculate canvas size to fit text tightly with minimal padding
      const padding = 20;
      const textWidth = textMetrics.width;
      const textHeight = fontSize * 1.2; // Approximate height based on font size

      // Create canvas sized to text
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(textWidth + padding * 2, 200);
      canvas.height = textHeight + padding * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // White background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw cursive text - large and filling the canvas
      ctx.fillStyle = "#1e293b";
      ctx.font = `${fontSize}px "Dancing Script", "Brush Script MT", cursive`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Position text in the center
      ctx.fillText(typedName, canvas.width / 2, canvas.height / 2);

      const dataUrl = canvas.toDataURL("image/png");
      onSave(dataUrl);
    }
  };

  const canSave =
    mode === "draw" ? hasDrawn : typedName.trim().length > 0 && acceptTyped;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <h3 className="text-lg font-semibold mb-4">Add Your Signature</h3>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode("draw")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors ${
              mode === "draw"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 hover:border-gray-300 text-gray-600"
            }`}
          >
            <PenTool className="w-4 h-4" />
            Draw
          </button>
          <button
            onClick={() => setMode("type")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors ${
              mode === "type"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 hover:border-gray-300 text-gray-600"
            }`}
          >
            <Type className="w-4 h-4" />
            Type
          </button>
        </div>

        {mode === "draw" ? (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Use your mouse or finger to draw your signature below.
            </p>

            <div className="border rounded-lg overflow-hidden mb-4 touch-none">
              <canvas
                ref={canvasRef}
                width={450}
                height={200}
                className="w-full cursor-crosshair"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={clearCanvas}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Apply Signature
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Type your full legal name below. It will appear as a signature.
            </p>

            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
              autoFocus
            />

            {/* Signature Preview */}
            <div className="border rounded-lg bg-white p-4 mb-4 h-[120px] flex items-center justify-center overflow-hidden">
              {typedName ? (
                <p
                  className="text-gray-800 whitespace-nowrap"
                  style={{
                    fontFamily: '"Dancing Script", "Brush Script MT", cursive',
                    fontSize: `clamp(24px, ${Math.max(80 - typedName.length * 3, 32)}px, 80px)`,
                  }}
                >
                  {typedName}
                </p>
              ) : (
                <p className="text-gray-400 text-sm">
                  Your signature will appear here
                </p>
              )}
            </div>

            {/* Acceptance Checkbox */}
            <label className="flex items-start gap-3 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptTyped}
                onChange={(e) => setAcceptTyped(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">
                I understand and agree that this typed signature will be the
                electronic representation of my signature for all purposes, and
                has the same legal effect as a handwritten signature.
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Apply Signature
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
