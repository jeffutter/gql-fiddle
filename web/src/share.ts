import * as pako from "pako";

export interface WorkspacePayload {
  subgraphs: { name: string; sdl: string }[];
  queryTabs: { name: string; query: string }[];
  activeQueryTab: number;
  seed: number;
  /** Raw YAML mock config string. Optional for backward compat with older share URLs. */
  mockConfig?: string;
}

/**
 * A single named workspace entry stored in the v5 localStorage shape.
 *
 * v5 localStorage root (key: "graphql-playground"):
 * { workspaces: WorkspaceEntry[], activeWorkspaceIndex: number, vimMode: boolean }
 *
 * `id` and `version` are optional for backward compatibility with v4 data that
 * is in the process of being migrated; the v4→v5 migration in store.ts
 * backfills them via crypto.randomUUID() and version=1.
 */
export interface WorkspaceEntry {
  /** User-visible workspace name, e.g. "Workspace 1". */
  name: string;
  /** Stable client-generated UUID for cloud sync. Added in store v5. */
  id?: string;
  /** Monotonic version counter for last-write-wins. Bumped on each cloud sync push. */
  version?: number;
  subgraphs: { name: string; sdl: string }[];
  activeSubgraph: number;
  queryTabs: { name: string; query: string }[];
  activeQueryTab: number;
  seed: number;
  /** Raw YAML string for mock field overrides. Empty string means no overrides. */
  mockConfig: string;
  tourDraft: Tour | null;
}

export type PaneId = "schema" | "plan";

export interface PaneVisibility {
  schema?: boolean;
  plan?: boolean;
}

export interface TourStep {
  label: string;
  prose: string;
  anchor?: { subgraphIndex: number; typeName: string; fieldName?: string };
  overrides?: Partial<WorkspacePayload>;
  paneVisibility?: PaneVisibility;
}

export interface Tour {
  title: string;
  base: WorkspacePayload;
  steps: TourStep[];
}

const HASH_PREFIX = "#w=";
const TOUR_HASH_PREFIX = "#t=";

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
      mockConfig: typeof parsed.mockConfig === "string" ? parsed.mockConfig : "",
    };
  }

  // Backward compat: URLs encoded before TASK-78 do not have mockConfig.
  if (typeof parsed.mockConfig !== "string") {
    parsed.mockConfig = "";
  }

  return parsed as unknown as WorkspacePayload;
}

/** Encode a Tour into a URL hash fragment with the #t= prefix. */
export function encodeTour(tour: Tour): string {
  const json = JSON.stringify(tour);
  const compressed = pako.gzip(json);
  return TOUR_HASH_PREFIX + uint8ToBase64url(compressed);
}

/** Decode a #t= URL hash fragment back into a Tour. */
export function decodeTour(hash: string): Tour {
  if (!hash.startsWith(TOUR_HASH_PREFIX) || hash.length === TOUR_HASH_PREFIX.length) {
    throw new Error("Invalid tour hash: must start with #t= and contain encoded data");
  }
  const encoded = hash.slice(TOUR_HASH_PREFIX.length);
  const bytes = base64urlToUint8(encoded);
  const json = pako.inflate(bytes, { to: "string" });
  return JSON.parse(json) as Tour;
}

/**
 * Merge tour.base with the step's overrides to produce the workspace payload
 * for a given step. Merges at the top-level key granularity (spread), so an
 * override of `seed` does not affect `subgraphs` or `queryTabs`.
 */
export function resolveTourStep(tour: Tour, stepIndex: number): WorkspacePayload {
  const step = tour.steps[stepIndex];
  if (!step.overrides) return tour.base;
  return { ...tour.base, ...step.overrides };
}
