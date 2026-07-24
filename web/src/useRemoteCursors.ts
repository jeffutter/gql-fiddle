/**
 * useRemoteCursors — manages per-user cursor styling based on Yjs awareness state.
 *
 * Injects scoped CSS classes into the document head for each connected client,
 * so y-monaco's MonacoBinding can render colored remote selections.
 */

import { useEffect, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";

// Color palette for remote cursors (distinct, high-contrast)
const CURSOR_COLORS = [
  "#FF6B6B", // coral red
  "#4ECDC4", // teal
  "#FFE66D", // yellow
  "#95E1D3", // mint
  "#F38181", // salmon
  "#AA96DA", // lavender
  "#FCBAD3", // pink
  "#EAFFD0", // lime
];

/**
 * Assign a deterministic color based on client ID hash.
 */
function clientIdColor(clientId: number): string {
  const idx = Math.abs(hashNumber(clientId)) % CURSOR_COLORS.length;
  return CURSOR_COLORS[idx];
}

/** Simple hash for a numeric client ID. */
function hashNumber(n: number): number {
  let h = n;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return h ^ (h >>> 16);
}

/**
 * Style sheet manager for dynamic per-client cursor CSS.
 */
class CursorStyleSheet {
  private element: HTMLStyleElement | null = null;
  private rules = new Map<number, string>();

  constructor() {
    this.element = document.createElement("style");
    this.element.setAttribute("data", "live-sync-cursors");
    this.element.textContent = "";
    document.head.appendChild(this.element);
  }

  addRule(clientId: number, color: string): void {
    const baseClass = `yRemoteSelection-${clientId}`;
    const headClass = `yRemoteSelectionHead-${clientId}`;
    const rgba = hexToRgba(color, 0.3);
    this.rules.set(
      clientId,
      `
      .${baseClass} { background-color: ${rgba} !important; }
      .${headClass} { background-color: ${color} !important; }
    `,
    );
    this.flush();
  }

  removeRule(clientId: number): void {
    this.rules.delete(clientId);
    this.flush();
  }

  destroy(): void {
    this.element?.remove();
    this.element = null;
  }

  private flush(): void {
    if (!this.element) return;
    this.element.textContent = [...this.rules.values()].join("\n");
  }
}

/** Convert hex color to rgba with alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Hook that injects CSS for remote cursors based on awareness state.
 * Call this in any component that has access to the awareness instance.
 */
export function useRemoteCursors(awareness: Awareness | null): void {
  const stylesRef = useRef<CursorStyleSheet | null>(null);

  useEffect(() => {
    if (!awareness) return;

    const styles = new CursorStyleSheet();
    stylesRef.current = styles;

    const handleChange = () => {
      const states = awareness.getStates();
      for (const [clientId, state] of states.entries()) {
        if (state && typeof state === "object") {
          const color =
            ((state as Record<string, unknown>).color as string | undefined) ??
            clientIdColor(clientId);
          styles.addRule(clientId, color);
        } else {
          styles.removeRule(clientId);
        }
      }
    };

    awareness.on("change", handleChange);
    // Initial render
    handleChange();

    return () => {
      awareness.off("change", handleChange);
      styles.destroy();
      stylesRef.current = null;
    };
  }, [awareness]);
}
