import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

export function AboutModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fullscreen-modal-backdrop" onClick={onClose}>
      <div
        className="fullscreen-modal about-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        <div className="fullscreen-modal__header">
          <span className="fullscreen-modal__title" id="about-modal-title">
            About GraphQL Fiddle
          </span>
          <button className="btn btn--icon" onClick={onClose} aria-label="Close about">
            ✕
          </button>
        </div>
        <div className="fullscreen-modal__body about-modal__body">
          <section className="about-section">
            <h2 className="about-section__heading">Workspace security</h2>
            <p>
              Your workspace content — subgraph schemas, queries, and configuration — is encrypted
              in your browser before it is sent to our servers. We store ciphertext only; we never
              see your schemas or queries in plaintext.
            </p>

            <h3 className="about-section__subheading">Two-layer key system</h3>
            <p>Encryption uses AES-256-GCM with two separate keys:</p>
            <ul className="about-list">
              <li>
                <strong>Key Wrapping Key (KWK)</strong> — a random 256-bit key generated for your
                account and stored in our session store (Cloudflare KV).
              </li>
              <li>
                <strong>Data Encryption Key (DEK)</strong> — a random 256-bit key generated in your
                browser. The DEK is encrypted with the KWK and the resulting ciphertext is stored in
                our database (Cloudflare D1). Your plaintext DEK never leaves your browser.
              </li>
            </ul>
            <p>
              All workspace data is encrypted with the DEK. To reconstruct the DEK an attacker would
              need simultaneous access to both the session store (KWK) and the database (wrapped
              DEK) — neither alone is sufficient.
            </p>

            <h3 className="about-section__subheading">Cross-device sync</h3>
            <p>
              When you sign in on a new device, the browser fetches the KWK from our session store
              and the encrypted DEK from the database, then unwraps the DEK locally. After that
              first fetch, the DEK is cached in your browser for offline use.
            </p>

            <h3 className="about-section__subheading">Limitations</h3>
            <p>
              This is defense-in-depth, not end-to-end encryption. An operator with simultaneous
              access to both storage systems could reconstruct the DEK. Workspace names are
              encrypted alongside payloads. Anonymous (signed-out) sessions use a browser-local key
              that does not sync across devices.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
