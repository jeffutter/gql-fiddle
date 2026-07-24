---
id: TASK-120
title: 'Fix: idle-cleanup alarm deletes live sessions with active connections'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-23 06:05'
updated_date: '2026-07-23 20:30'
labels:
  - review-followup
  - planned
dependencies:
  - TASK-119.1
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-119.1 (live-sync/src/session.ts:333-361). LiveSession.alarm() deletes the session and force-disconnects clients purely based on idleMs = Date.now() - row.last_active_at > IDLE_TTL_MS, without ever checking this.clients.size. last_active_at is only bumped on WebSocket connect/disconnect (updateLastActive()) and on each debounced persist (save()), which only fires when a document update happens. If clients stay connected for 24h+ without making an edit (e.g. an idle open tab), the alarm wipes the persisted state, sends session-ended to every connected client, and clears this.clients — even though the session is NOT abandoned (it has live connections). This directly contradicts TASK-119.1's own AC #6: 'A session with no active connections for an extended idle period ... automatically cleans up'. The bug is untested: live-sync/tests/session.test.ts never instantiates the LiveSession class or calls .alarm() against an instance with connected clients — it only exercises raw Yjs behavior and raw D1 queries. Axis: Correct/Resilient.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 LiveSession.alarm() does not delete the session or disconnect clients when this.clients.size > 0, regardless of how stale last_active_at is; it reschedules the next alarm check instead
- [ ] #2 A new test in live-sync/tests/session.test.ts constructs a LiveSession instance (with a minimal fake DurableObjectState providing id.toString(), blockConcurrencyWhile, and storage.setAlarm as a no-op, plus a D1 mock via createD1Mock) with a stale last_active_at (>24h old) and at least one entry in the private clients set, calls alarm(), and asserts the D1 row still exists and the fake client was not sent a session-ended message
- [ ] #3 A companion test confirms the existing behavior is preserved: alarm() still deletes the session and notifies clients when last_active_at is stale AND clients.size === 0
- [ ] #4 nix develop -c pnpm --dir live-sync test run passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
One-line guard + two unit tests in live-sync/.

## Code fix (live-sync/src/session.ts)

In the alarm() method (~line 352), replace:
  if (idleMs > IDLE_TTL_MS) { ...delete... }
with:
  if (this.clients.size === 0 && idleMs > IDLE_TTL_MS) { ...delete... }

Keep the delete branch's body unchanged (notify loop + this.clients.clear()). When clients.size is 0, the notify loop is a no-op anyway — leaving it in costs nothing and is defensive.

## Tests (live-sync/tests/session.test.ts)

Add a new describe block 'Idle cleanup alarm' after the existing 'Reconnect behavior' block.

### Test 1: does not delete session with active connections
- Import LiveSession from '../src/session'
- Build a minimal fake DurableObjectState: { id: { toString: () => 'sess-1' }, blockConcurrencyWhile: async fn => fn(), storage: { setAlarm: async () => {} } } cast via 'as unknown as DurableObjectState' (matching the repo's pattern from functions/__tests__/d1-mock.ts)
- Create db via createD1Mock(MIGRATION_SQL) (already imported)
- Insert a row with last_active_at 25h in the past
- Construct new LiveSession(fakeState, { LiveSession: {} as DurableObjectNamespace, DB: db })
- Add a fake client to the private clients set via type cast: '(instance as unknown as { clients: Set<{ ws: WebSocket; clientId: string }> }).clients.add({ ws: fakeWs, clientId: "c1" })' where fakeWs = { readyState: WebSocket.OPEN, send: vi.fn(), addEventListener: vi.fn(), close: vi.fn() }
- Call await instance.alarm()
- Assert: D1 row still exists (SELECT * FROM live_sessions WHERE id = ? returns non-null)
- Assert: fakeWs.send was never called (no session-ended message sent)

### Test 2: deletes abandoned session with no connections
- Same setup but do NOT add any client to the clients set
- Call await instance.alarm()
- Assert: D1 row is deleted (query returns null)
- This preserves the existing behavior for truly-abandoned sessions

## Verification

nix develop -c pnpm --dir live-sync test run
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- AC #1: alarm() checks this.clients.size === 0 before deleting — sessions with active connections are preserved and alarm is rescheduled
- AC #2: New test 'does NOT delete session when active connections exist' — constructs LiveSession with fake DO state, stale last_active_at (25h), and a connected client; asserts D1 row survives and no session-ended message sent
- AC #3: Companion test 'deletes abandoned session with no active connections' — confirms existing behavior preserved for truly abandoned sessions
- Bonus test: 'reschedules alarm when session is still within idle TTL' — covers the else branch
- AC #4: All 18 tests pass (pnpm test run in live-sync/)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
One-line guard in LiveSession.alarm(): added this.clients.size === 0 check so idle cleanup only fires on truly abandoned sessions (no active WebSocket connections). Three new unit tests cover all alarm code paths.
<!-- SECTION:FINAL_SUMMARY:END -->
