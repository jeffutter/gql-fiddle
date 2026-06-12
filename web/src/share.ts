import * as pako from "pako";

export interface WorkspacePayload {
  subgraphs: { name: string; sdl: string }[];
  query: string;
  variables: string;
  seed: number;
}

const HASH_PREFIX = "#w=";

/** Convert a Uint8Array to URL-safe base64 (no padding). */
function uint8ToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Decode a URL-safe base64 string (no padding) back to Uint8Array. */
function base64urlToUint8(str: string): Uint8Array {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  while (s.length % 4 !== 0) {
    s += "=";
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}

/** Encode a workspace payload into a URL hash fragment. */
export function encode(payload: WorkspacePayload): string {
  const json = JSON.stringify(payload);
  const compressed = pako.gzip(json);
  const encoded = uint8ToBase64url(compressed);
  return HASH_PREFIX + encoded;
}

/** Decode a URL hash fragment back into a workspace payload. */
export function decode(hash: string): WorkspacePayload {
  if (!hash.startsWith(HASH_PREFIX)) {
    throw new Error("Invalid share hash: missing prefix");
  }
  const b64url = hash.slice(HASH_PREFIX.length);
  if (b64url.length === 0) {
    throw new Error("Invalid share hash: empty payload");
  }
  const bytes = base64urlToUint8(b64url);
  const json = pako.inflate(bytes, { to: "string" });
  return JSON.parse(json) as WorkspacePayload;
}
