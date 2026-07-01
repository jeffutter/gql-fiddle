import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonError, withErrorHandling } from "../_lib/http";

function makeCtx(
  url = "http://localhost/api/whatever",
): Parameters<PagesFunction>[0] {
  return {
    request: new Request(url),
    env: {},
    params: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
    pluginArgs: {},
    functionPath: "",
  } as unknown as Parameters<PagesFunction>[0];
}

describe("jsonError", () => {
  it("returns a JSON body of { error } with the given status", async () => {
    const res = jsonError("Not found", 404);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Not found" });
  });
});

describe("withErrorHandling", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("passes through the handler's response when it doesn't throw", async () => {
    const handler = withErrorHandling(async () => Response.json({ ok: true }));
    const res = await handler(makeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns a generic JSON 500 when the handler throws, without leaking the original message", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("db exploded: user_id=super-secret-id-123");
    });
    const res = await handler(makeCtx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Internal error" });
    expect(JSON.stringify(body)).not.toContain("super-secret-id-123");
  });

  it("logs the original error message and request path server-side", async () => {
    const handler = withErrorHandling(async () => {
      throw new Error("db exploded: user_id=super-secret-id-123");
    });
    await handler(makeCtx("http://localhost/api/workspaces/abc"));

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    const record = JSON.parse(line);
    expect(record.event).toBe("unhandled_error");
    expect(record.path).toBe("/api/workspaces/abc");
    expect(record.message).toContain("super-secret-id-123");
  });
});
