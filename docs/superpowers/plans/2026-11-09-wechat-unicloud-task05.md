# Issue #5 implementation plan

Approved source: the user's approved plan in this chat and the overall `2026-11-03-wechat-unicloud-design.md`, Task05. Execution: inline, single-page editor, one final independent review. Work stays in the requested `miniapp-dev` checkout. No Git commit/push, issue closure or production release is authorized.

## Task 1 — Shared text recipe domain

- Add typed create/get/list/update, recipes collection/indexes and home-recipes/recipes-co using existing identity, family, transaction, content and quota ports.
- Bind writes to expected family/generation, preserve immutable server fields, reject stale versions, audit all text outside transactions and guard membership inside writes. Receipts bind the complete payload and recover commit-unknown.
- Bound Unicode fields and 32 KiB UTF-8 JSON, preserve raw unknown quantities, page by immutable creation time and ID.
- RED then GREEN domain/cloud-contract tests: normal family flows, foreign access, payload tampering, boundaries, audit failure/delay, competing edits, membership races/ABA, replay, rollback and lost acknowledgements.

## Task 2 — Client and actual pages

- Add API/controller and one durable pending intent per UID, production/harness wiring, protected cache invalidation and strict response validation.
- Family home entry, recipe list/detail/edit; single-page ingredient/step rows, optional metadata/tags. Unknown results retry the original intent; conflicts retain local input and require confirmation before reload.
- RED then GREEN actual SFC/controller tests for roundtrip, duplicate taps, cold start, weak network, conflicts, hidden/unloaded responses, logout/account/context changes and lost access.

## Task 3 — Verification and evidence

- Extend exact object/route boundary lists, textarea test support, Task05 preview/doctor and separate evidence hashes without rewriting historical acceptance.
- Run all miniapp Taskfile check commands with Node 22.23.3/pnpm 10.20.0 and Vitest maxWorkers=2, plus diff check and one independent final review; regression-test substantive fixes.
- Prepare exact isolated upload scope and preserve remote identity/config/bridge. Cloud/device acceptance stays pending until actually observed and authorized for the concrete target.
