# Task 01 capabilities

Updated 2026-11-04. The user confirmed cloud and device acceptance and authorized closing #1. #2 is not started.

| Capability | Status | Evidence / remaining requirement |
| --- | --- | --- |
| Isolated checkout baseline | confirmed | `git status --short`: only `?? docs/superpowers/` before this implementation |
| Local Node | confirmed | Explicit `fnm/node-versions/v22.23.3/installation/node.exe`; inherited PATH is Node 26.10.0 and must not be used |
| pnpm | confirmed | Session-only 10.20.0 tarball, npm registry SHA512 verified; no global install |
| Task | confirmed | Official v3.54.0 Windows amd64, release checksums verified; no global install |
| Dependency compatibility | local PASS after explicit approval | Vue/runtime-core 3.4.21, types 3.4.31; all other approved versions unchanged. Strict-peer install and frozen-lock reinstall exited 0; no overrides/peer ignores |
| Cloud provider | confirmed read-only | Coordinator's official HBuilderX CLI list returned provider=alipay for the target space; unique root is `uniCloud-alipay` |
| Region / cloud runtime | accepted | Upload warning reported cloud Node 18.18.2. Client invoke host was `api-hz`. The user accepted this on 2026-11-04 |
| Shared identity / instance limiter | local PASS | Same guard in fixture and account-co; current account/status/token membership/revocation before refresh; eight identity + three limiter scenarios |
| Source / assembly / minimal public surface | local PASS | Complete fixed official ZIP, 305 tracked generated files, deterministic repeat/check; two objects, three public methods; ten generated Schemas all CRUD false |
| SFC lifecycle / logout barriers | local PASS, substitutes only | Actual SFC callbacks driven by test harness; SDK-order substitute writes token before Promise resolution; closed marker, epoch, whole-flow/request draining and queued next login |
| Template types / source-artifact-secret gates | local PASS | Valid boolean button passes; number prop reports line-2 TS2322; client/cloud/tests strict checks; source + actual WeChat artifact scans |
| Complete local check | PASS | `task -d miniapp check`: lint, three type checks, 54 tests / 8 suites, WeChat build, source/artifact gates |
| Doctor / preview | READY | `ops/acceptance.json` records the user acceptance. `ops/deploy-preview.json` remains the earlier pre-upload snapshot |
| HBuilderX cloud TS compilation | accepted | Authorized uploads of the Task 01 cloud objects and common modules are recorded in `test-evidence.md` |
| Cloud login / logout / direct-call / clientDB acceptance | passed | Simulator evidence is in `test-evidence.md`. The user accepted the remaining cloud checks on 2026-11-04 |
| WeChat device acceptance / real SDK races | passed | The user accepted device acceptance on 2026-11-04. No additional token or screenshot was stored |
| Upload authorization | closed for #1 | Uploads already performed are recorded in `test-evidence.md`. This close does not authorize production deployment |

Optional uni-helper MCP is unavailable; approved fallback is Context7 plus current maintainer docs. No skills/plugins installed by this implementer.

Coordinator installed official `unicloud` plugin, version `3.0.14-2026102820`, under HBuilderX `5.34.2026102909`. Read-only source: `D:/HBuilderX/cli.exe unicloud service-space list --json true --protocol-version 1 --request-id task01-readonly-space-verified`. Later authorized cloud calls are recorded in `test-evidence.md`.

## Historical stop and approved correction

The original candidate installation failed on the two exact peer conflicts
recorded in `test-evidence.md`. Work stopped until the coordinator relayed the
user's explicit minimal-version approval. The corrected lock now reflects the
successful install and local check. No other pinned version was changed.

The package now retains the official template's default CommonJS package
semantics; adding `type:module` had caused the CLI's CJS uni-plugin import to
fail. ESLint alone uses explicit `eslint.config.mjs`. This was a correction to
our configuration, not an upgrade or suppression of a dependency conflict.
The Vite 5 CJS-API deprecation warning remains visible; it is not an error.

`uniStatistics.enable=false` is explicit. Only login/onboarding are present in
the built app.json; no upstream auth store/router or non-WeChat page is installed.

## Fixed upstream metadata / licenses

Original archive is `vendor/uni-id/upstream.zip` (official endpoint serves ZIP,
not the plan's proposed tar.gz). No extension spoofing, revision change, new Git
repository, or modification to upstream archive/internal libraries occurred.
Both archives and every generated-file hash are retained under `vendor/`.

Plugin-root versions: uni-badge 1.2.2; uni-captcha 0.7.5; uni-cloud-s2s 1.0.1;
uni-config-center 0.0.3; uni-data-checkbox 1.0.3; uni-easyinput 1.1.9; uni-forms
1.4.10; uni-get-phone-number 1.0.1; uni-icons 2.0.8; uni-id-common 1.0.17;
uni-id-pages 1.1.29; uni-list 1.2.14; uni-load-more 1.3.3;
uni-open-bridge-common 1.2.0; uni-popup 1.8.4; uni-scss 1.0.3;
uni-transition 1.3.2. These plugin-root packages do not declare a license field;
their original readmes/metadata remain intact rather than inventing one.

Cloud package metadata: uni-captcha 0.7.0 / Apache-2.0 (LICENSE.md retained);
uni-config-center 0.0.3 / Apache-2.0; uni-id-common 1.0.17 / Apache-2.0;
uni-open-bridge-common 1.0.0 / ISC; uni-cloud-s2s 1.0.1 and uni-id-co 1.1.28
do not declare a package license. The official template's fixed archive has no
LICENSE file. No new independent project license is claimed; root AGPL-3.0
obligations remain. Local import/check is not legal/release approval.

## Acceptance close

- The project is associated with alipay space `mealie` / `env-00jy7289et7b`.
  Functions are `account-co` and `uni-id-co`. Common modules include the
  restored `uni-id-common` 1.0.19 and `uni-config-center` without `config.json`.
  `uni-open-bridge-common` remains plugin 1.2.1. Ten identity schemas and two
  indexes exist; clientDB actions do not.
- On 2026-11-04 the user confirmed that cloud and device acceptance is
  complete. `ops/acceptance.json` is the doctor record and points at
  `ops/test-evidence.md`. Secret values were not printed or stored.
- This confirmation closes #1. It does not start #2 or authorize production
  deployment.
