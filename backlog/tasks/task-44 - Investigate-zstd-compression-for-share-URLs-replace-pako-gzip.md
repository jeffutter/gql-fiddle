---
id: TASK-44
title: Investigate zstd compression for share URLs (replace pako/gzip)
status: To Do
assignee: []
created_date: '2026-06-12 20:29'
updated_date: '2026-06-12 20:32'
labels:
  - spike
  - performance
  - sharing
  - url
dependencies:
  - TASK-43
priority: low
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Share URLs are currently encoded as: JSON → gzip (`pako`) → base64url → `#w=…` hash (`share.ts`). Zstd typically achieves better compression ratios than gzip on structured text, which would produce shorter URLs. This is a spike to find the best way to bring zstd into the browser and decide whether the switch is worth making.

**What to investigate**

1. **Pure-JS/WASM zstd library** — evaluate packages such as `fzstd` (decompress-only, ~30 KB) and `@bokuweb/zstd-wasm` or `zstd-wasm` (compress + decompress). Measure bundle-size delta vs. pako (~50 KB gzipped) and compression ratio on a representative workspace payload.

2. **Expose from the existing WASM module** — the `gql-core` crate already builds to WASM via `wasm-pack`. Adding the `zstd` Rust crate and exporting two `#[wasm_bindgen]` functions (`compress(data: &[u8]) -> Vec<u8>` / `decompress(data: &[u8]) -> Vec<u8>`) would avoid shipping a second WASM file. Measure the binary-size increase to `gql_core_bg.wasm`.

**Deliverable**

A short written recommendation (in task notes or a follow-up subtask) covering:
- Which approach wins on bundle size + compression ratio
- Any gotchas (async init of WASM, CSP headers for WASM blobs, etc.)
- A go/no-go recommendation on switching

If the answer is "go", promote the spike findings into an implementation subtask.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Compression ratio of zstd vs gzip is benchmarked on at least one realistic workspace payload (e.g. two subgraphs with SDL + a query).
- [ ] #2 Bundle-size impact of each approach (JS library vs WASM export) is measured and documented.
- [ ] #3 A clear go/no-go recommendation is written up with rationale.
- [ ] #4 If 'go': an implementation subtask is created with a concrete plan.
<!-- AC:END -->
