import { afterEach, describe, expect, it, vi } from "vitest";
import { exportSvg, svgToString } from "./imageExport";

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 200 100");
  svg.setAttribute("width", "200");
  svg.setAttribute("height", "100");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "200");
  rect.setAttribute("height", "100");
  rect.setAttribute("fill", "#16243a");
  svg.appendChild(rect);
  return svg as SVGSVGElement;
}

describe("svgToString", () => {
  it("produces a self-contained SVG with xmlns and explicit dimensions (AC#3)", () => {
    const out = svgToString(makeSvg());
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="200"');
    expect(out).toContain('height="100"');
    // Child nodes (and their inline colors) travel with the clone.
    expect(out).toContain("<rect");
    expect(out).toContain("#16243a");
  });
});

describe("exportSvg", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downloads an image/svg+xml blob under the given filename (AC#3, AC#6)", () => {
    // jsdom does not implement object URLs; stub before spying.
    if (!URL.createObjectURL) URL.createObjectURL = () => "blob:mock";
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

    const created: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      created.push(b as Blob);
      return "blob:mock";
    });
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let downloadName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    exportSvg(makeSvg(), "sequence-diagram.svg");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(created[0].type).toContain("image/svg+xml");
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe("sequence-diagram.svg");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
