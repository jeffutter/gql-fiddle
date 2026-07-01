/**
 * Image-export helpers for on-screen SVG diagrams (Mermaid, D3, etc.).
 *
 * Every function is keyed on a live <svg> node, so any view that renders an SVG
 * can reuse them — nothing here is specific to the sequence diagram. Callers
 * choose the filename; failures throw so the caller can surface them.
 */

/** Trigger a browser download of `blob` as `filename` via a transient anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Intrinsic pixel size of an SVG. Prefers the viewBox (Mermaid always emits
 * one), then the width/height attributes, then the on-screen bounding box.
 * Never returns zero — a degenerate node falls back to 800x600.
 */
function svgPixelSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: vb.width, height: vb.height };
  }
  const w = parseFloat(svg.getAttribute("width") ?? "");
  const h = parseFloat(svg.getAttribute("height") ?? "");
  if (w > 0 && h > 0) return { width: w, height: h };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 800, height: rect.height || 600 };
}

/**
 * Serialize a live <svg> into a standalone, self-contained SVG string. Adds the
 * xmlns declarations and explicit width/height so the file renders outside the
 * app. Mermaid inlines its <style>, so colors travel with the cloned node.
 */
export function svgToString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = svgPixelSize(svg);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(clone);
}

/** Serialize `svg` and download it as a self-contained image/svg+xml file. */
export function exportSvg(svg: SVGSVGElement, filename: string): void {
  const source = `<?xml version="1.0" encoding="UTF-8"?>\n${svgToString(svg)}`;
  downloadBlob(new Blob([source], { type: "image/svg+xml;charset=utf-8" }), filename);
}

/**
 * Rasterize `svg` onto a canvas and download it as a PNG. `background` is a CSS
 * color painted behind the (transparent) SVG so the PNG is never see-through.
 * Scales by devicePixelRatio for a crisp image on high-DPI displays.
 */
export async function exportPng(
  svg: SVGSVGElement,
  filename: string,
  background: string,
): Promise<void> {
  const { width, height } = svgPixelSize(svg);
  const scale = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  ctx.scale(scale, scale);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // encodeURIComponent (not base64) keeps Unicode labels intact in the data URL.
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgToString(svg))}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to rasterize the SVG"));
    img.src = svgUrl;
  });
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode the PNG");
  downloadBlob(blob, filename);
}
