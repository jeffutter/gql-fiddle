---
id: TASK-109
title: Fix tour anchor substring type matching and add resolveTourStep bounds guard
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/tourHighlight.ts:41 gates the field-anchor branch with line.includes(typeName), so anchor 'User' latches onto 'type UserProfile {' or a field line 'user: User' — highlighting the wrong line (the no-fieldName branch already uses a precise regex). Also typeName/fieldName are interpolated into new RegExp unescaped (throws on regex metacharacters). Separately, web/src/share.ts:145 resolveTourStep does no bounds check on stepIndex — tour.steps[stepIndex] can be undefined (empty steps / out-of-range initialStepIndex) and step.overrides then throws. Fix: reuse the precise declaration regex for the enter-type test, escapeRegExp interpolated names, and guard 'if (\!step) return tour.base;'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 an anchor for User.id highlights User, not UserProfile
- [ ] #2 a field name containing regex metacharacters does not throw
- [ ] #3 an out-of-range or empty tour step returns the base payload without throwing
<!-- AC:END -->
