import { useState } from "react";

/**
 * Copies text to the clipboard and tracks a transient "copied" flag that
 * reverts after `revertDelayMs`. Falls back to a hidden textarea + execCommand
 * when the async Clipboard API isn't available (e.g. insecure contexts).
 *
 * The clipboard-API path flips `copied` inside the `.then()` callback (so it
 * lands on a microtask); the execCommand fallback flips it synchronously.
 * This mirrors the two copy mechanisms' actual timing — don't collapse them
 * into a single async function, or the synchronous fallback path would pick
 * up a spurious microtask delay.
 */
export function useCopyToClipboard(revertDelayMs = 1500) {
  const [copied, setCopied] = useState(false);

  function copy(text: string) {
    const markCopied = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), revertDelayMs);
    };
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(markCopied);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      markCopied();
    }
  }

  return [copied, copy] as const;
}
