// Client-side AES-256-GCM encryption for workspace sync.
//
// Two-layer key system:
//   KWK (Key Wrapping Key) — random 256-bit key stored in KV on the server.
//   DEK (Data Encryption Key) — random 256-bit key generated in the browser,
//     wrapped (encrypted) with the KWK and stored in the D1 database.
//
// Workspace payloads are compressed with deflate then encrypted with the DEK.
// Neither the server's KV store nor its database alone can decrypt user data —
// both are required to reconstruct the DEK.
//
// The DEK is also cached in localStorage for offline resilience. On a new device,
// it is reconstructed from the KWK + wrapped DEK fetched from the server.
import * as pako from "pako";

const DEK_CACHE_KEY = "gql-fiddle-dek";
const PREFIX = "E1:";
const COMPRESSED_PREFIX = "CE1:";

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function importAesGcm(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesGcmEncrypt(key: CryptoKey, data: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(data)),
  );
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(ciphertext, 12);
  return toBase64(combined);
}

async function aesGcmDecrypt(key: CryptoKey, b64: string): Promise<Uint8Array | null> {
  try {
    const combined = fromBase64(b64);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

// Module-level DEK promise — reset on each initEncryption call so re-login
// picks up the correct user's key.
let dekPromise: Promise<CryptoKey> | null = null;

async function loadLocalKey(): Promise<CryptoKey> {
  const cached = localStorage.getItem(DEK_CACHE_KEY);
  if (cached) return importAesGcm(fromBase64(cached));
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(DEK_CACHE_KEY, toBase64(bytes));
  return importAesGcm(bytes);
}

// Called during login (before any workspace sync). Fetches the KWK from the
// server, unwraps (or generates) the DEK, and caches it for offline use.
// Falls back to the locally cached DEK if the server is unreachable.
export async function initEncryption(): Promise<void> {
  dekPromise = null;
  try {
    const res = await fetch("/api/auth/enc-meta", { credentials: "include" });
    if (!res.ok) throw new Error(`enc-meta: ${res.status}`);
    const { kwk: kwkB64, wrapped_dek: wrappedB64 } = (await res.json()) as {
      kwk: string;
      wrapped_dek: string | null;
    };

    const kwk = await importAesGcm(fromBase64(kwkB64));

    let dekBytes: Uint8Array;

    if (wrappedB64) {
      const dekRaw = await aesGcmDecrypt(kwk, wrappedB64);
      if (dekRaw) {
        dekBytes = fromBase64(new TextDecoder().decode(dekRaw));
      } else {
        // KWK/wrapped_dek mismatch (e.g. race on first login) — keep local key.
        dekPromise = loadLocalKey();
        return;
      }
    } else {
      // First device for this user: generate DEK, wrap it, store on server.
      dekBytes = crypto.getRandomValues(new Uint8Array(32));
      const wrapped = await aesGcmEncrypt(kwk, new TextEncoder().encode(toBase64(dekBytes)));
      await fetch("/api/auth/enc-meta", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wrapped_dek: wrapped }),
      });
    }

    localStorage.setItem(DEK_CACHE_KEY, toBase64(dekBytes));
    // Store as already-resolved so getOrCreateKey() never hits the thread pool.
    const dek = await importAesGcm(dekBytes);
    dekPromise = Promise.resolve(dek);
  } catch {
    dekPromise = loadLocalKey();
  }
}

// Returns the DEK. Falls back to a locally generated key (offline / anonymous).
// The returned Promise is already resolved after initEncryption completes.
export function getOrCreateKey(): Promise<CryptoKey> {
  if (!dekPromise) dekPromise = loadLocalKey();
  return dekPromise;
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const compressed = pako.deflate(plaintext);
  return COMPRESSED_PREFIX + (await aesGcmEncrypt(key, compressed));
}

// Returns plaintext, or the original value unchanged if decryption fails.
// CE1: — compressed+encrypted (current format)
// E1:  — encrypted without compression (legacy)
// no prefix — plaintext (legacy, pre-encryption)
export async function decrypt(key: CryptoKey, value: string): Promise<string> {
  if (value.startsWith(COMPRESSED_PREFIX)) {
    const bytes = await aesGcmDecrypt(key, value.slice(COMPRESSED_PREFIX.length));
    if (bytes === null) return value;
    return pako.inflate(bytes, { to: "string" });
  }
  if (value.startsWith(PREFIX)) {
    const bytes = await aesGcmDecrypt(key, value.slice(PREFIX.length));
    if (bytes === null) return value;
    return new TextDecoder().decode(bytes);
  }
  return value;
}
