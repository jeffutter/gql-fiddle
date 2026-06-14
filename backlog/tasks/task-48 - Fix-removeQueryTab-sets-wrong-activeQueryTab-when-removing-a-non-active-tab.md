---
id: TASK-48
title: 'Fix: removeQueryTab sets wrong activeQueryTab when removing a non-active tab'
status: Done
assignee: []
created_date: '2026-06-14 05:02'
updated_date: '2026-06-14 05:33'
labels:
  - review-followup
  - store
  - bug
milestone: m-4
dependencies:
  - TASK-30
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-30 (web/src/store.ts:103-115). **Correct axis: Correct.**

The `removeQueryTab` reducer in `web/src/store.ts` computes the new active index as:
```ts
const newActive = Math.min(index, remaining.length - 1);
```
This is only correct when the removed tab IS the active tab (index === activeQueryTab). The other two cases are wrong:

**Case 1 — removing before the active tab** (index < activeQueryTab):  
3 tabs [Q1,Q2,Q3], active=2, remove index 0 → remaining=[Q2,Q3], user's tab is now at index 1.  
Current: `Math.min(0,1)` = 0 → **lands on Q2 instead of Q3**.

**Case 3 — removing after the active tab** (index > activeQueryTab):  
3 tabs [Q1,Q2,Q3], active=0, remove index 2 → remaining=[Q1,Q2], user's tab is still Q1.  
Current: `Math.min(2,1)` = 1 → **lands on Q2 instead of Q1**.

The fix is a three-way branch:
```ts
let newActive: number;
if (state.activeQueryTab === index) {
  newActive = Math.min(index, remaining.length - 1);   // tab gone: pick nearest
} else if (state.activeQueryTab > index) {
  newActive = state.activeQueryTab - 1;                // tab before active: shift left
} else {
  newActive = state.activeQueryTab;                    // tab after active: unchanged
}
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Closing a query tab that is BEFORE the currently active tab keeps the user on the same tab (active index decrements by 1)
- [x] #2 Closing a query tab that is AFTER the currently active tab keeps the user on the same tab (active index unchanged)
- [x] #3 Closing the currently active tab selects the nearest remaining tab (existing behaviour preserved)
- [x] #4 Closing the only remaining tab resets to a default empty tab at index 0 (existing behaviour preserved)
- [x] #5 store.test.ts has tests covering all four cases above
- [x] #6 nix develop -c bash -c 'cd web && pnpm test run' passes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced Math.min(index, remaining.length - 1) with a three-way branch in removeQueryTab (web/src/store.ts): remove-active → Math.min(index, remaining.length-1); remove-before-active → activeQueryTab - 1; remove-after-active → activeQueryTab unchanged. Added two new store tests covering the before-active and after-active cases alongside the existing active-tab and last-tab tests. All 94 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
