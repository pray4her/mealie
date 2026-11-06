# Task 02 capabilities

Updated 2026-11-06. User selected per-task subagent implementation with independent review. Work is limited to Task 02; no cloud upload or Git commit.

| Capability | Status | Evidence / next verification |
| --- | --- | --- |
| Prerequisite #1 | closed | GitHub CLI read of native blocked_by; historical cloud/device acceptance is recorded for #1 |
| Local toolchain | confirmed | Existing Node 22.23.3, pnpm 10.20.0, Task 3.54.0; session-only PATH |
| Local baseline | PASS | `task -d miniapp check`: 54 tests / 8 suites, three type checks, lint, WeChat build and artifact/secret gates |
| Per-task implementation/review | local delivery approved | Tasks 1–5 and Task 6 local preparation independently approved, followed by whole-ticket review. After reviewed HBuilderX type-library, SDK void-commit and cross-realm secure-randomness corrections: 339 tests/23 suites, lint, three TS checks, WeChat build and boundary/secret gates PASS |
| Target transaction/primary-key behavior | pending | Documentation is not proof; isolated cloud tests required |
| Content module | locally assembled and independently reviewed | User imported uni-sec-check@2.0.2 through HBuilderX; exact original ZIP archived, 19 source files preserved and deterministic assembly verified. Live content service/configuration remains pending |
| Current cloud target identifiers | confirmed read-only 2026-11-06 | Official HBuilderX `service-space list` again returned provider=alipay, spaceId=env-00jy7289et7b, spaceName=mealie; only these public fields were emitted |
| Current cloud resource names | deployed and read back 2026-11-06 | Following separate user approval: 3 objects, 9 common modules, 14 Schemas, 0 actions; four business Schemas deny all 16 clientDB operations. Protected modules remain byte-identical; no probes deployed |
| Normal cloud compilation/artifact | confirmed | Actual HBuilderX checks/build/upload succeeded; cloud runtime warning reports Node 18.18.2. Exact remote compiled payload captured and hashed, excluding private configuration; see deployment record and evidence |
| Cloud/device Task 02 acceptance | pending | Do not infer from #1 acceptance or local substitutes |
| DevTools actual happy path | user confirmed | First-login family query recovered after the void-commit correction; real creation entered the family page after the client cross-realm buffer correction. Broader cloud scenarios and physical-device acceptance remain pending |

The named superpowers execution skill is unavailable locally. The selected workflow is coordinated directly using available collaboration tools; it is not reported as a loaded skill.

Official content module metadata: [marketplace #5460](https://ext.dcloud.net.cn/plugin?id=5460), accessed 2026-11-05. Version 2.0.2 is dated 2023-11-20 and adds appId support. The page publishes a DCloud ecosystem source license; the downloaded source and included license are preserved rather than described as MIT. The user imported the module through HBuilderX and Task 3 archived/assembled it from the original ZIP as described below.

The public marketplace download UI checks login. No authenticated download endpoint was invoked by the agent and no local credentials were read. An alternate official `dcloud/uni-ai-chat` source contains `uni-sec-check` 2.0.1, which does not match the fixed candidate and was not imported or silently substituted. The user then supplied HBuilderX's successful 2.0.2 import log; original ZIP is `C:/Users/Administrator/AppData/Local/Temp/uni_modules/cache/source/uni-sec-check@2.0.2.zip`, SHA-256 `63f5ce5f56f0d667fe10f26474b921f387bfb22ed6501ca069552c77299435b1`.

All 19 installed uni-sec-check files match the original cached ZIP byte-for-byte (per-entry SHA-256 comparison, path containment checked, no extraction). The new assembler can adopt these exact verified files; it must still reject modified/nonmatching files.

HBuilderX also added `origin-plugin-dev-name`, `origin-plugin-version`, `plugin-dev-name`, and `plugin-version` to the existing uni-config-center 0.0.3 cloud package metadata, plus formatting. Git diff showed no runtime code change, but the original assembly check rejected the imported metadata. Task 3 resolved this through a tested, repeatable policy limited to those four exact values and the unchanged original package fields; arbitrary modifications remain rejected. Both assembly checks now pass, preserving the user's import and original identity ZIP.

Read-only inspection of actual 2.0.2 source: `platform/mp-weixin/wx-api.js` normalizes successful errCode to numeric 0. `protocol.js/filterValue` rewrites review/risky results to `uni-sec-check-risk-content`; the content adapter must recognize this exact known risk status as rejected, rather than treating all nonzero errCodes as unavailable. Unknown/malformed statuses remain unavailable. Cloud module package metadata declares ISC while the public plugin page includes a DCloud source license; preserve both original notices without inventing a replacement license.

Existing local bridge provenance has two version fields: plugin descriptor 1.2.0, nested cloud package descriptor 1.0.0. The actual source exposes getAccessToken; do not silently change descriptors to claim a different version. Historical #1 cloud inventory records plugin 1.2.1, so the eventual upload preview must compare source/current cloud resources and avoid implicitly downgrading that dependency. Real module resolution and credentials remain cloud acceptance items.

Deployment preparation must account for the observed Task 01 side effect in `ops/test-evidence.md` under “uni-id-co upload side effect”: a non-force upload still replaced transitive uni-id-common and uni-config-center, requiring an explicitly authorized restore. Absence of --force is therefore not proof that existing dependencies will be preserved. Before asking for Task 02 upload approval, identify the current protected module versions/content and prepare a preservation strategy (for example, an isolated staging payload that retains their exact remote bytes) or clearly state the unresolved limitation. Do not try an upload to discover its side effects.

Read-only HBuilderX CLI resource-name inventory on 2026-11-05: functions `account-co`, `uni-id-co`; common modules `home-contracts`, `home-kernel`, `uni-captcha`, `uni-cloud-s2s`, `uni-config-center`, `uni-id-common`, `uni-open-bridge-common`; schemas `uni-id-users`, `uni-id-roles`, `uni-id-permissions`, `uni-id-log`, `uni-id-device`, `opendb-verify-codes`, `opendb-tempdata`, `opendb-open-data`, `opendb-frv-logs`, `opendb-device`; no clientDB actions. Only resource names/counts and public target fields were emitted. No cloud code, user rows, or secret configuration was downloaded/read by these checks.

The installed CLI also supports read-only `unicloud cloud-resource list-dependencies`. For local family-co (kind=object), selected direct common modules are home-contracts, home-kernel and home-family; selected extensions are empty. Its nine common-module and nine extension entries are available options, not all requested dependencies. Transitive file dependencies and upload side effects still require review; this read does not authorize uploading any option.

## Protected dependency refresh and upload staging — 2026-11-06

The HBuilderX process was not running on resumption. It was started locally in a hidden window; only read-only CLI operations followed. Function/common-module/schema/action lists match the 2026-11-05 inventory. `database inspect-initialize-conflicts` additionally lists real remote collection names: the four business collections are absent; all ten identity collections exist. There are no local init-data files, schema extensions or validators.

Supported `unicloud common-module download` downloaded only the three protected modules to a fresh temporary project outside the repository, without force. Package metadata and runtime index hashes were compared; credential configuration contents were never read or emitted.

| Module | Current cloud metadata | Local archived metadata | Runtime comparison |
| --- | --- | --- | --- |
| uni-id-common | package/plugin 1.0.19 | package 1.0.17 | index.js differs; retain cloud copy |
| uni-config-center | package 0.0.3 | package 0.0.3 | index.js matches; cloud has secret configuration, retain entire cloud copy outside repository |
| uni-open-bridge-common | package 1.0.0 / plugin 1.2.1 | package 1.0.0 / plugin descriptor 1.2.0 | index.js differs; retain cloud copy without rewriting version declarations |

Current cloud index.js SHA-256: uni-id-common `569c1d28e46bb5aa4dd388e509257ff5cbc9b6aa68b75d5e3a91eaa4b8c02438`; config-center `569c0ec9f9f575997ee1dd3d7539a0c54fcb8c78872ba936c02b022bbde47991`; bridge `9a783ad05de8e973ee2d43478650b6c8abcf4f1620d382b7272ac005e5fdfccb`. These are public runtime-code hashes, not secret-config hashes.

A separate narrow upload staging project was prepared at `%TEMP%/opencode/task02-upload-stage-20261106`, with read-only snapshots at `%TEMP%/opencode/task02-cloud-readonly-20261106`. Every file of the three protected cloud modules was copied to staging and verified byte-for-byte by hashes; no configuration was copied into the repository. This staging contains only family-co; home-contracts/home-kernel/home-family; uni-sec-check plus the three preserved modules; the four business Schemas and family_members index. It excludes account-co, uni-id-co, unrelated identity modules and all ten identity database Schemas. Local uni_modules root descriptors remain unchanged provenance; the protected nested cloud packages and runtime are the actual remote bytes.

The installed CLI identifies exactly these seven available common modules in staging and selects the three direct home-* dependencies for family-co, with zero extensions. Staging database conflict inspection reports exactly families/family_members/mutation_receipts/request_limits locally, no remote conflicts, only family_members index, no data/extensions/validators. No upload, association, initialization or cloud test ran. Staging is a source preparation, not an HBuilderX-compiled or deployed artifact. Reconcile hashes against final reviewed source and refresh protected copies again if the target changes before upload.

The reviewable proposed resource inventory is [task02-upload-scope.json](task02-upload-scope.json): 13 entries (1 object, 7 common modules, 4 Schemas, 1 index), all uploadAuthorized=false. Each source/file digest is explicit; secret-config files are omitted from the published hashes. All 12 file-dependency paths resolve inside the narrow staging project. Temporary test artifacts and exact test-row cleanup remain separate reviewed entries before authorization.

## Approved deployment completed - 2026-11-06

The user approved the concrete 13-resource proposal. [task02-deployment.json](task02-deployment.json) is the current authorization/result record; task02-upload-scope.json remains the immutable pre-approval proposal, including its historical flags and kernel digest. A separately implemented/reviewed ES2022 type-library declaration corrected HBuilderX's fixed ES2021 checker without runtime changes. The current kernel source digest and actual source/client/cloud artifact digests are recorded in the deployment receipt.

All approved uploads/collection creations completed and independent readback review passed. Post-upload inventories and protected-module byte equality are confirmed; no probe was deployed. Actual normal cloud runtime bytes were captured from official remote ZIPs before the installed downloader removed __dist__, avoiding source-only downloads being mislabelled compiled output. Full local check is now 323 tests/23 suites. Actual authenticated cloud acceptance and physical-device testing remain pending; the earlier unbound probe manifest must be refreshed/bound to the current compiled common modules before any separate test authorization.

## User acceptance and closeout - 2026-11-06

用户已确认真机实测通过并要求关闭 #2。最新本地 full check 为 350 tests / 23 suites，全量检查通过；已验证生成的压缩和按需注入配置。此前“physical-device pending”是历史状态，现已有用户总体通过结论；详细设备、构建及逐场景证据仍未提供，云端并发/故障/权限/限流矩阵不据此推定通过，doctor 保持严格。当前摘要与最终关闭记录见 task02-test-evidence.md、task02-acceptance.json、task02-deployment.json。客户端正式预览使用 HBuilderX 关联空间后的发行菜单；Task 普通 CLI 构建是本地质量检查，不能代替服务空间注入。
