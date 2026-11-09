# Issue #4 implementation plan

Approved source: the user's implementation request and the overall `2026-11-03-wechat-unicloud-design.md`, Task04. Reuse the existing member page; dissolution remains Task18.

Closeout (2026-11-09): implementation and isolated deployment delivered; the user confirmed cloud business, concurrency and physical-device acceptance and explicitly authorized issue closure, commit and push to upstream/miniapp-dev. Final acceptance and the distinction from historical independent evidence are recorded in `miniapp/ops/task04-closeout.md`. No later ticket or production release is included.

## Task 1 — Generation-bound cloud operations

- Add MembershipMutation (requestId/familyId/generation), MemberMutation (+uid/targetGeneration), MemberView.generation and leave/removeMember/transferOwner.
- Strict input, trusted identity and same-family checks; atomic member/owner/version/receipt writes, both transfer generations rotated, existing mutation fence retained.
- Read receipts before current role checks: leave survives absence; remove never touches a rejoined target on replay; transfer verifies post-context. Full payload hashing prevents stale first delivery and request reuse. Reuse quotas, bounded retries and commit-unknown recovery.
- Test real create/invite/join, permissions, ABA, races, rollback and lost acknowledgements; update adapter, harness, mocks and public export allowlist.

## Task 2 — Client recovery and member page

- One durable complete lifecycle intent per UID; same request on uncertain retry; resume before role gating or no-family redirect. Transient checking/null never clears durable pending.
- Invalidate protected caches and late responses on confirmed relationship changes. Refresh current after results/errors; keep login, route to onboarding only after confirmed absence.
- Existing member page: member leave, owner remove/transfer with native confirmation and stable target identification; lifecycle/account guards and no duplicate tap.
- Test controller and actual SFC recovery, cancel, weak network, cold start, account change and hidden/unloaded responses.

## Task 3 — Verification and independent evidence

- Extend existing preview/doctor with Task04 scenario evidence and independent source/cloud/client/device hashes; preserve earlier evidence.
- Run all Taskfile check steps with pinned tools and `--maxWorkers=2`, plus `git diff --check`; one independent final review, fix substantive findings with regression tests.
- Prepare exact isolated upload scope, preserve identity/config/bridge dependencies. Cloud and device scenarios remain pending until actually observed; no automatic deployment, commit/push, issue closure or production publication.
