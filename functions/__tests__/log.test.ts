import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "../_lib/log";

describe("logEvent", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits a single JSON line containing event and ts", () => {
    logEvent("auth.login_success", { user_id: "u1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as string;
    const record = JSON.parse(line);
    expect(record.event).toBe("auth.login_success");
    expect(typeof record.ts).toBe("string");
    expect(record.user_id).toBe("u1");
  });

  it("redacts fields whose keys match the sensitive-key denylist", () => {
    logEvent("data.dek_write", {
      token: "abc",
      wrapped_dek: "xyz",
      kwk: "k",
      payload: "p",
      access_token: "secret-value",
      password: "hunter2",
      code: "oauth-code",
      user_id: "u1",
    });

    const line = logSpy.mock.calls[0]![0] as string;
    const record = JSON.parse(line);
    expect(record.token).toBe("[redacted]");
    expect(record.wrapped_dek).toBe("[redacted]");
    expect(record.kwk).toBe("[redacted]");
    expect(record.payload).toBe("[redacted]");
    expect(record.access_token).toBe("[redacted]");
    expect(record.password).toBe("[redacted]");
    expect(record.code).toBe("[redacted]");
    expect(record.user_id).toBe("u1");
  });

  it("defaults to no extra fields when none are given", () => {
    logEvent("auth.logout");
    const line = logSpy.mock.calls[0]![0] as string;
    const record = JSON.parse(line);
    expect(record.event).toBe("auth.logout");
    expect(record.level).toBe("info");
  });
});
