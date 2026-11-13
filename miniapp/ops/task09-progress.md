# Issue #9 execution ledger

Plan: user-approved Issue #9 image import plan (2026-11-13). Baseline: `73dbf9d4a`, clean `miniapp-dev`.

Ruling: work in the requested existing miniapp-dev checkout; no new worktree, dependency, automatic commit, push or issue closure. Test-space deployment and real vision acceptance up to USD 1 are authorized. Preserve existing business quotas. Raw import images use the explicitly accepted Task07 file-ID/SDK reading boundary, not strict storage isolation.

Pre-flight: image input uses business mediaId; media ownership/review/retention feeds the existing import job, provider, accounting and recipe transaction. Client receives only MediaView/JobView. Data URLs remain worker-only. Reuse Wot 2.4.0 and CLI 1.2.1, HomeAction/Form/FormItem; D-01/02/03/05/06/10/11/12, P-10/P-11, S-PREVIEW/S-UNI/S-WOT-AI. No Refero MCP is available; retain the approved reference lock and craft guidance.

Baseline: 7 related Vitest suites / 100 tests passed on Node 22.23.3. System pnpm fallback selects incompatible Node/pnpm; use installed local CLIs if the exact Task toolchain is unavailable. No engine changes.

Tasks:
1. Contracts, protected import media, vision worker, retention and regression tests: in progress.
2. Image selection/upload/review, form and scoped recovery: pending.
3. Full checks, independent review, test-space deployment and bounded real acceptance: pending.
