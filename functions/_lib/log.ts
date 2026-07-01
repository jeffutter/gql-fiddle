// Structured JSON logging for security-relevant events (auth, session,
// permission, and data-access events). This is the ONLY place that writes
// these events to console output, so it owns the redaction policy: any field
// whose key looks like it could carry a secret is redacted here, as a
// backstop that holds even if a call site accidentally passes a forbidden
// value. Call sites should still only ever pass identifiers (user_id,
// workspace_id, reason, path) — redaction is defense-in-depth, not the
// primary control.
const SENSITIVE_KEY_PATTERN =
  /token|secret|kwk|wrapped_dek|payload|code|password/i;

export type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export function logEvent(event: string, fields: LogFields = {}): void {
  const redacted: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }

  const record = {
    level: "info",
    event,
    ...redacted,
    ts: new Date().toISOString(),
  };
  console.log(JSON.stringify(record));
}
