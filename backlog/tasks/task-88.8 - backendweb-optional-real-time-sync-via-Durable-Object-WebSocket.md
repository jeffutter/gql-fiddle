---
id: TASK-88.8
title: 'backend+web: optional real-time sync via Durable Object WebSocket'
status: To Do
assignee: []
created_date: '2026-06-26 12:14'
updated_date: '2026-06-26 21:14'
labels:
  - backend
  - web
  - sync
  - optional
  - cloudflare
dependencies:
  - TASK-88.7
parent_task_id: TASK-88
priority: low
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

**Optional enhancement** (parent TASK-88). Focus/visibility pull (TASK-88.7) already satisfies "auto-sync between devices" for a fiddle tool. This task upgrades the experience to near-instant propagation between devices that are open simultaneously, only if there's demand. Do not start unless the pull-based sync proves insufficient.

## Depends on

TASK-88.7 — builds on the established sync engine and reconciliation; this only changes the *transport* for change notifications.

## Scope

- Add a **Durable Object** (one per user) that holds WebSocket connections for that user's open devices. Free tier: 1M requests/month — keep within it.
- A Function endpoint upgrades to WebSocket and routes the connection to the user's DO (authenticated via the existing session).
- On a successful `PUT`/`DELETE` to the workspace API, notify the user's DO, which **broadcasts a lightweight invalidation** (e.g. `{ changedId, version }`) to that user's other connected devices.
- Client: when connected, on receiving an invalidation, do a targeted `GET ?since` and reconcile via the existing merge logic (reuse TASK-88.6). Fall back to the pull-based strategy when the socket is unavailable.
- Keep last-write-wins; the WebSocket only carries change *signals*, not authoritative state.

## Notes

- This adds real complexity (DO lifecycle, WS reconnection, auth on upgrade). Weigh value vs cost per the project's design philosophy before implementing.
- Must degrade gracefully: if the DO/WS path fails, the app behaves exactly like TASK-88.7.

## Tests & docs

- Test the broadcast-on-write path and that a received invalidation triggers a reconciling pull.
- Test graceful fallback when the socket drops.
- Document the DO architecture and free-tier considerations in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A per-user Durable Object maintains authenticated WebSocket connections for that user's open devices
- [ ] #2 A successful workspace PUT/DELETE broadcasts a lightweight invalidation to the user's other connected devices
- [ ] #3 On receiving an invalidation, a client does a targeted ?since pull and reconciles via the existing merge logic
- [ ] #4 If the WebSocket/DO path is unavailable, the app degrades gracefully to the TASK-88.7 pull-based behavior
- [ ] #5 Implementation stays within Durable Objects free-tier limits
- [ ] #6 Tests cover broadcast-on-write, invalidation-triggered pull, and socket-drop fallback; AGENTS.md documents the DO architecture
<!-- AC:END -->
