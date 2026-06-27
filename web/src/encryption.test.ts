import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrCreateKey, encrypt, decrypt, initEncryption } from "./encryption";

// ---------------------------------------------------------------------------
// encrypt / decrypt roundtrips (uses getOrCreateKey offline fallback)
// ---------------------------------------------------------------------------

describe("encrypt / decrypt", () => {
  it("roundtrip: decrypt(encrypt(x)) === x", async () => {
    const key = await getOrCreateKey();
    const plaintext = '{"subgraphs":[],"queryTabs":[{"name":"Q1","query":"{ me { id } }"}]}';
    const ciphertext = await encrypt(key, plaintext);
    expect(ciphertext.startsWith("CE1:")).toBe(true);
    expect(await decrypt(key, ciphertext)).toBe(plaintext);
  });

  it("passes legacy plaintext through unchanged", async () => {
    const key = await getOrCreateKey();
    const plaintext = '{"subgraphs":[],"queryTabs":[]}';
    expect(await decrypt(key, plaintext)).toBe(plaintext);
  });

  it("each call produces a distinct ciphertext (IV randomness)", async () => {
    const key = await getOrCreateKey();
    const a = await encrypt(key, "same");
    const b = await encrypt(key, "same");
    expect(a).not.toBe(b);
  });

  it("both ciphertexts decrypt to the same plaintext", async () => {
    const key = await getOrCreateKey();
    const plaintext = "workspace name";
    const c1 = await encrypt(key, plaintext);
    const c2 = await encrypt(key, plaintext);
    expect(await decrypt(key, c1)).toBe(plaintext);
    expect(await decrypt(key, c2)).toBe(plaintext);
  });
});

// ---------------------------------------------------------------------------
// initEncryption — two-layer key initialization
// ---------------------------------------------------------------------------

describe("initEncryption", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and stores a wrapped DEK when server has none", async () => {
    const kwkBytes = crypto.getRandomValues(new Uint8Array(32));
    const kwkB64 = btoa(Array.from(kwkBytes, (b) => String.fromCharCode(b)).join(""));

    let capturedBody: { wrapped_dek?: string } = {};
    vi.spyOn(globalThis, "fetch").mockImplementation((url, opts) => {
      if (String(url).endsWith("/api/auth/enc-meta") && (!opts || opts.method !== "PUT")) {
        return Promise.resolve(
          new Response(JSON.stringify({ kwk: kwkB64, wrapped_dek: null }), { status: 200 }),
        );
      }
      // PUT — capture the body
      capturedBody = JSON.parse((opts?.body as string) ?? "{}") as typeof capturedBody;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await initEncryption();

    expect(capturedBody.wrapped_dek).toBeDefined();
    expect(typeof capturedBody.wrapped_dek).toBe("string");

    // The initialized key works for encrypt/decrypt.
    const key = await getOrCreateKey();
    const ct = await encrypt(key, "hello");
    expect(await decrypt(key, ct)).toBe("hello");
  });

  it("unwraps an existing wrapped DEK from the server", async () => {
    // Generate a known DEK and wrap it with a known KWK.
    const kwkBytes = crypto.getRandomValues(new Uint8Array(32));
    const kwkB64 = btoa(Array.from(kwkBytes, (b) => String.fromCharCode(b)).join(""));
    const dekBytes = crypto.getRandomValues(new Uint8Array(32));
    const dekB64 = btoa(Array.from(dekBytes, (b) => String.fromCharCode(b)).join(""));

    // Use the same AES-GCM wrapping that initEncryption uses internally.
    const kwk = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(kwkBytes),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kwk, new TextEncoder().encode(dekB64)),
    );
    const combined = new Uint8Array(12 + enc.byteLength);
    combined.set(iv);
    combined.set(enc, 12);
    const wrappedDek = btoa(Array.from(combined, (b) => String.fromCharCode(b)).join(""));

    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url).endsWith("/api/auth/enc-meta")) {
        return Promise.resolve(
          new Response(JSON.stringify({ kwk: kwkB64, wrapped_dek: wrappedDek }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await initEncryption();

    // The unwrapped DEK should decrypt data encrypted with the known DEK bytes.
    const knownDek = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(dekBytes),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const ct = await encrypt(knownDek, "cross-device");
    const key = await getOrCreateKey();
    expect(await decrypt(key, ct)).toBe("cross-device");
  });

  it("falls back to local key when server is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    // Should not throw; falls back to loadLocalKey().
    await expect(initEncryption()).resolves.toBeUndefined();

    const key = await getOrCreateKey();
    const ct = await encrypt(key, "offline");
    expect(await decrypt(key, ct)).toBe("offline");
  });
});
