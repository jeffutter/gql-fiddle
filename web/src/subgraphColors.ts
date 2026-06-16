/**
 * Deterministic subgraph → color palette mapping.
 *
 * Hash-based: the same subgraph name always maps to the same palette slot,
 * regardless of encounter order. The palette wraps at PALETTE_SIZE entries so
 * additional subgraphs reuse slots (unlikely in practice beyond 10 services).
 *
 * The CSS custom properties (--sg-0 … --sg-9) are defined in theme.css.
 * Monaco's `inlineClassName` requires injected CSS classes, so we generate
 * those once via `injectSubgraphStyles()`.
 *
 * Shared by field-attribution decorations (this file) and the Entity Ownership
 * Graph (TASK-56) for visual consistency across the app.
 */

const PALETTE_SIZE = 10;

/**
 * Deterministic hash for a subgraph name → palette index.
 * Returns a non-negative integer.
 */
export function hashSubgraphName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PALETTE_SIZE;
}

/**
 * Returns the CSS `var(--sg-N)` reference string for a given subgraph name.
 * Useful for inline style color references.
 */
export function subgraphColorVar(name: string): string {
  return `var(--sg-${hashSubgraphName(name)})`;
}

/**
 * Inject a `<style>` tag with `.sg-bg-N` and `.sg-glyph-N` CSS classes so
 * Monaco's `inlineClassName` / `glyphMarginClassName` decoration options work.
 *
 * Must be called after the DOM is ready (e.g. inside a React `useEffect`).
 * Idempotent — safe to call multiple times.
 */
export function injectSubgraphStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("sg-decoration-styles")) return;

  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const lines: string[] = [];

  for (let i = 0; i < PALETTE_SIZE; i++) {
    const color = computed.getPropertyValue(`--sg-${i}`).trim();
    // Inline highlight: translucent background + solid bottom border.
    lines.push(
      `.sg-bg-${i} { background-color: ${color}33; border-bottom: 1.5px solid ${color}; border-radius: 2px; }`,
    );
    // Glyph margin dot.
    lines.push(
      `.sg-glyph-${i} { display: flex; align-items: center; justify-content: center; }` +
        `.sg-glyph-${i}::before { content: ''; display: block; width: 8px; height: 8px;` +
        ` border-radius: 50%; background: ${color}; margin: auto; }`,
    );
  }

  const el = document.createElement("style");
  el.id = "sg-decoration-styles";
  el.textContent = lines.join("\n");
  document.head.appendChild(el);
}
