import * as pako from "pako";

export interface WorkspacePayload {
  subgraphs: { name: string; sdl: string }[];
  queryTabs: { name: string; query: string }[];
  activeQueryTab: number;
  seed: number;
}

const HASH_PREFIX = "#w=";

/** Convert a Uint8Array to URL-safe base64 (no padding). */
function uint8ToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Decode a URL-safe base64 string (no padding) back to Uint8Array. */
function base64urlToUint8(str: string): Uint8Array {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
  const parsed = JSON.parse(json) as Record<string, unknown>;

  // Backward compat: URLs encoded before TASK-30 had flat `query`/`variables`
  // fields instead of `queryTabs`. Convert them on the fly.
  if (!Array.isArray(parsed.queryTabs)) {
    const q = typeof parsed.query === "string" ? parsed.query : "";
    return {
      subgraphs: parsed.subgraphs as WorkspacePayload["subgraphs"],
      queryTabs: [{ name: "Query 1", query: q }],
      activeQueryTab: 0,
      seed: typeof parsed.seed === "number" ? parsed.seed : 42,
    };
  }

  return parsed as unknown as WorkspacePayload;
}
