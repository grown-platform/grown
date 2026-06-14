/**
 * Lightweight device heuristics for the Translate app.
 *
 * On-device models are large (NLLB ~600M params, Supertonic ~398 MB of ONNX).
 * Phones — especially **iOS**, where every browser is WebKit with a hard
 * per-tab memory cap — can't hold the full-precision models and get the page
 * killed mid-load. These helpers let us pick memory-appropriate variants
 * (quantized model on mobile) and skip the heaviest features on iOS.
 */

/** iOS (iPhone/iPad/iPod), including iPadOS that reports as desktop Safari. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS Safari but exposes touch points.
  return (
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  );
}

/** Any phone/tablet — used to pick lighter, memory-cheaper on-device models. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return isIOS() || /Android|Mobile/.test(ua);
}
