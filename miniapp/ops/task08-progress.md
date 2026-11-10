# Issue 8 execution ledger

Source: approved user plan, 可恢复的 AI 文本导入 (2026-11-09).

Scope: contracts and client adapters; shared recipe creation; import jobs, quotas, usage and worker; private timer and public submit/get/cancel; recovery controller and pages; harness, schemas, indexes, boundaries, deployment preview and doctor.

Pre-flight: worker saves through the existing recipe validator and membership transaction guard; the client consumes only JobView. Original input and provider credentials remain server side after submit acknowledgment.

Ruling: execute in the clean miniapp-dev checkout requested by the plan; no extra worktree or branch integration step. No cloud deployment or paid request is authorized by this implementation handoff; prepare offline artifacts and leave external evidence needs-info.

Tasks:
1. Cloud job lifecycle, accounting, provider validation, atomic recipe creation: implemented; 24 lifecycle tests and 19 provider tests pass.
2. Public/private entrypoints, schemas and security boundaries: implemented; public-object contract and boundary tests pass, cloud type check passes.
3. Client recovery, page lifecycle and navigation: implemented; 5 page tests and 2 adapter tests pass.
4. Deployment evidence gates: implemented, gate fixtures pass. Full check and fresh whole-change review in progress.

TDD evidence: first domain test failed because imports was absent, then passed alongside 66 recipe tests. Audit-resume test caught missing persisted usage; fixed with candidate and usage checkpoint. Hidden acknowledgment test caught retained raw pending input; now updates the scoped durable ID without displaying or navigating. Boundary and ops tests failed before new surfaces and readiness gates were implemented, then passed.

Ruling: default cloud enable switch is false; task and USD limits are unlimited when absent. Fixtures explicitly enable calls. Deployment instructions require cloud-only enable/key setup after resource reconciliation.

Ruling: recent authenticated mp-weixin submit/get records visitedAt, used conservatively for the two-hour audit window; the real WeChat checker remains authoritative. Worker does not depend on the page session token, so logout does not cancel background work.

2026-11-10 public unauthenticated OpenRouter model catalog lookup found the pinned model and response_format/structured_outputs parameters. No completion request, credentials, deployment or device operation performed; real provider evidence remains needs-info.

Initial full check: lint and all three type checks passed; 644/647 tests passed. Three failures: one newly added hidden acknowledgment regression (fixed), and two legacy inventory assertions for old resource/object counts (updated to the seven new resources). Targeted regression: 41/41 passed. Full check restarted after fixes.

Full check before final review: 54 suites / 666 tests, lint, client/cloud/test types, WeChat build, boundaries and secret scan passed.

Fresh reviewer: task08_review found three Important issues and no Critical issues. One fix pass:
- Checkpoint accounting on cancel/membership/retention/visit/account termination: five new tests failed, then passed after persisted usage is loaded before eligibility checks and checkpoint settlement runs in terminal transactions.
- Lost submit then logout: new page regression failed, then passed after retaining the original pending request under its user/family/generation storage key; other scopes never display it.
- Expired backlog above cleanup batch and expiry during provider request: two new regressions failed, then passed after independent claim, call and final-save expiration checks.
- Accounting follow-up: late known usage can upgrade an earlier unknown settlement exactly once; the regression failed and passed after allowing that upgrade. A status lookup for an older job cannot overwrite a newer pending submission; its page regression also failed then passed.

Ruling: pending unacknowledged text survives logout in its isolated scope to satisfy original-request replay; it is concealed outside that scope and removed on acknowledgment or rejected at local seven-day restore. No global history or cross-account lookup added.

Review external conditions: real provider completion/fees, timer firing, database conflict codes and transaction semantics, official cloud compilation, secret configuration presence and physical-device flows remain needs-info. No merge or external publication performed.

Final verification: `task -d miniapp check -- --maxWorkers=2` exit 0; 54 suites / 676 tests, all lint/type/build/boundary/secret gates passed after review fixes. Work remains in miniapp-dev without commit/push. Deployment preparation is offline only.

Follow-up user authorization: deploy and explain cloud API key placement. 2026-11-10 deployed ten scoped resources to existing alipay space env-00jy7289et7b via official HBuilderX CLI. Added pure-type Buffer inheritance declaration to match existing home-media workaround; actual HBuilderX built-in compiler failed first (2 diagnostics) and passed after the declaration. Complete local check rerun passed 54 suites / 676 tests. New objects' actual compiled ZIP entries captured and source matched; 43 real deployed JS modules load with intended exports. Fresh before/after comparisons preserved 34 private dependency files, 6 existing function source trees and 2 business modules. Real-network empty-session submit/get/cancel all AUTH_REQUIRED. Environment variable names are empty; no API key values read, set or logged; imports remain default-disabled. Paid provider, real minute trigger and device business verification remain needs-info. Earlier offline-only statements describe the previous implementation turn and are superseded by this deployment record.
