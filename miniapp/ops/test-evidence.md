# Task 01 evidence

User acceptance on 2026-11-04 closes this ticket. The final section is the acceptance record; earlier sections stay as the contemporaneous log.

## Scope and baseline — 2026-11-03

- Sole implementer for `miniapp/`; independent review coordinated elsewhere.
- Approved seams/scenarios: detailed Task 01 plan sections 1.2/1.3 and Steps 2/7/12/18. No additional design decisions requested.
- Baseline `git status --short`: `?? docs/superpowers/` only. These files were not changed or removed.
- Tracker read/claim handled by coordinator, not repeated here.
- At initial preparation the provider was unknown; no speculative cloud root was created.

### Coordinator's verified provider handoff

The coordinator reports successful official plugin installation (`D:/HBuilderX/plugins/unicloud/package.json`: `3.0.14-2026102820`) and read-only command:

`D:/HBuilderX/cli.exe unicloud service-space list --json true --protocol-version 1 --request-id task01-readonly-space-verified`

Filtered non-secret target result: `{provider:'alipay',spaceId:'env-00jy7289et7b',spaceName:'mealie'}`. `project-target.json` now fixes unique cloud root `uniCloud-alipay` and the previously approved public identifiers. Region/runtime remain unknown; no cloud compilation/deployment acceptance is inferred. Existing-resource listing is owned by the coordinator, not duplicated here.

## Tool preparation (not a business RED/GREEN cycle)

- Inherited `node --version`: `v26.10.0`. Explicit approved binary exists under `C:/Users/Administrator/AppData/Roaming/fnm/node-versions/v22.23.3/installation/` and is used for this project.
- Downloaded `https://registry.npmjs.org/pnpm/-/pnpm-10.20.0.tgz` into session tools. SHA512 integrity matched registry: `sha512-z5mYIiFi3YWGTQqBAueJLnukzq3rv1ox+cL85I384xepxTufZGTR75BCy6LgKuAqn3wUOitDjNk8kYQPAZK53Q==`. Explicit Node + `pnpm.cjs --version`: `10.20.0`.
- Downloaded official Task `v3.54.0` Windows amd64 zip, compared release checksums. SHA256 `837f42f71899ea41d07a47acc81d4d6ea80cb41c68292345f915c656473efcb7`; `task.exe --version`: `3.54.0`.
- All tools are under `C:/Users/Administrator/AppData/Local/Temp/opencode/mealie-task01-tools`; no global PATH/configuration changes.
- Context7 resolved uni-app and Vitest before single-concept lifecycle / independent-test-config queries. No matching uni-app-types library; consulted `https://uni-typed.netlify.app/guide/uni-app-types` directly. It documents TS5/6, Bundler, pnpm hoisting and optional volar plugin.

## Execution status

### Step 1 — installation compatibility gate: BLOCKED

Actual commands used a **process-local** PATH prefix:

```powershell
$env:PATH = 'C:/Users/Administrator/AppData/Roaming/fnm/node-versions/v22.23.3/installation;C:/Users/Administrator/AppData/Local/Temp/opencode/mealie-task01-tools;C:/Users/Administrator/AppData/Local/Temp/opencode/mealie-task01-tools/task;' + $env:PATH
pnpm install # working directory D:/pray4her/mealie/miniapp
```

- First attempt reached the shell's 120,000 ms timeout while resolving/downloading; no PASS/RED inferred. Retried the same command with a 600,000 ms timeout.
- Retry exited **1** with `ERR_PNPM_PEER_DEP_ISSUES` after preparing 952 packages. Key output (no secrets):

```text
@dcloudio/uni-automator 3.0.0-5030420261029002
  @dcloudio/uni-cli-shared 3.0.0-5030420261029002
    @vue/server-renderer 3.4.21
      unmet peer vue@3.4.21: found 3.4.38
@dcloudio/uni-app 3.0.0-5030420261029002
  unmet peer @dcloudio/types@3.4.31: found 3.4.19
```

- Read-only confirmation in the downloaded package manifests: `node_modules/@dcloudio/uni-app/package.json` peer types is exactly `3.4.31`; `node_modules/@dcloudio/uni-cli-shared/package.json` dependencies pin `@vue/server-renderer` and Vue compiler packages to `3.4.21`.
- Per plan 0.3/Step 1: **STOP**. Did not disable strict peers, change versions, patch upstream internals, or proceed to implementation.
- `pnpm-lock.yaml` exists from the failed candidate resolution; it is not evidence of a successful install or compatible set.
- Registry also warned about deprecated ESLint 9.39.1 and vue-i18n 9.14.5; no silent upgrades were made.

### Source preparation status

- Downloaded the exact official template codeload archive into session tools; SHA256 matched the recorded `vendor/template/lock.json`: `e972a1fa6445c3693f71d2f1abb7d164fcf886a482557ae38c690f206c778e7b`. Inspected its file list and entry/config sources. It contains no LICENSE file; revision-specific GitHub license API returned 404. No MIT license claim made.
- Template archive not yet copied into checkout; vendor import is **incomplete**, accurately documented in its README. Generated/handwritten project files are only preparation.
- Probed official uni-id fixed-revision archive URLs before installation completed: the `/-/archive/...` URL returned an HTML shell and `/api/v4/.../archive.tar.gz` returned 404, not a valid archive. No uni-id archive was accepted, no source hash invented, no source copied or assembled. A read-only `git ls-remote https://gitcode.com/dcloud/hello_uni-id-pages.git HEAD` confirmed remote reachability; no clone or new Git repository was created. Source acquisition must resume only after the compatibility decision.

### Unexecuted test and acceptance work

No business tests executed. No RED/GREEN/PASS claims. Step 1 is incomplete;
Steps 2–22 have not started. There is no runnable login product, cloud root
source, assembler, complete check/doctor, or deployment preview yet. Cloud
provider target data is recorded but region/runtime remain unknown.

HBuilderX TS compilation, cloud acceptance, and real-device acceptance are
**blocked/unverified**, not substituted by mocks. No cloud calls by this
implementer; no association, upload, database initialization, Git stage,
commit/push, tracker writes, root dependency changes, or old-app changes.

Final `git status --short` before handoff: `?? docs/superpowers/` and
`?? miniapp/` only. The independent reviewer should treat this as a blocked
preparation checkpoint, not as completed #1 work.

## Authorized resumption

Coordinator reports explicit user approval of the minimal version correction:
`@dcloudio/types` 3.4.19 → 3.4.31 and Vue / runtime-core 3.4.38 → 3.4.21.
All other fixed versions remain unchanged; strict peers remain enabled. The
earlier failed candidate remains historical evidence, not a passed install.
Independent preparation review found no blocking defects; final implementation
will require a separate review. No deployment authorization was added.

Coordinator's read-only resource-list attempts returned `BUSINESS_ERROR` for
both repository-root and miniapp project paths. Existing resource state remains
**unknown**; never assume an empty space. Region/runtime remain unknown.

## 2026-11-04 actual resumption

- The previous session's subscription usage interruption is not a product failure.
- Authorized corrected `pnpm install` completed (15.6 s, pnpm 10.20.0). Reconfirmed on 2026-11-04 with `pnpm install --frozen-lockfile`: exit 0, lock up to date, 1.3 s. Strict peer/engine checks remain enabled. pnpm reports ignored dependency build scripts; no blanket approval enabled.
- Official GitCode's linked RepoBranchNav frontend asset identifies `raw.gitcode.com` as archive host and `/archive/refs/heads/<ref>.zip` as public download pattern. Downloaded the **exact approved revision**, not HEAD: `https://raw.gitcode.com/dcloud/hello_uni-id-pages/archive/refs/heads/993791b9eb298be8013f22daa9f2efee6c50cc23.zip`.
- Actual ZIP SHA256: `f00cc35dec2ebadc10e2cfc5850b38859227d2ec0d351a1b371c24df892fd3b9`. `tar -tf` confirms complete root `hello_uni-id-pages-993791b9eb298be8013f22daa9f2efee6c50cc23/`; extracted into approved temp tools, uni-id-pages package is 1.1.29. Official endpoint offers ZIP, not tar.gz: preserve original bytes as `vendor/uni-id/upstream.zip`, never rename it to pretend gzip. No new Git repository created.

### Step 3 — identity/policy business RED

`task -d miniapp test -- tests/domain/identity.test.ts tests/domain/request-limit.test.ts tests/contracts/uni-id-entry.test.ts`

Exit 1, **13 failed tests in 3 loaded suites** (650 ms). Identity's eight named scenarios fail against explicit not-implemented guard; limiter's three scenarios fail against explicit not-implemented limiter; two entry policy scenarios fail against explicit not-implemented policy. All modules collected successfully; no missing files/dependencies counted as business RED. Policy lifecycle/actual-source logout contract follows in the assembly cycle.

### Steps 6 / 8 / 11 — identity GREEN, assembly RED → GREEN

| Actual command / checkpoint | Actual result |
| --- | --- |
| `task -d miniapp test -- tests/domain/identity.test.ts tests/domain/request-limit.test.ts` | exit 0; 11 tests, 2 suites PASS (549 ms). Policy not included in this claim |
| `task -d miniapp test -- tests/contracts/vendor-assembly.test.ts tests/contracts/boundaries.test.ts tests/contracts/uni-id-entry.test.ts` before assembler implementation | exit 1; 9 tests in 3 collected suites fail against explicit assembler/policy not-implemented behavior; real archive already present, not a missing-download RED |
| Same command after initial implementation | exit 1; official Schema JSONC comments rejected by JSON.parse (6 failed / 5 passed). This is an implementation parsing defect, not a new business RED or a source-availability failure |
| Same command after parsing official JSONC via the already-pinned TypeScript API | exit 0; 11 tests PASS / 3 suites (2.59 s) |
| Original Step 3 command repeated | exit 0; 14 tests PASS / 3 suites (1.42 s) |

`node scripts/assemble-uni-id.mjs` generated tracked resources; subsequent
`--check` comparisons are read-only. Tests repeat assembly into exact random
test directories and compare bytes, reject unknown sources/digest mismatch,
modified/non-generated files, malicious archive paths and duplicate objects.
No upstream internal code was hand-patched. Generated Schemas preserve other
structure/indexes while applying the explicit four-false collection policy.
No example database initialization or actual secret config is copied.

The pinned auth middleware contract and later actual official logout-library
execution were coverage additions after the first policy implementation. Their
first runs are **not claimed as their own test-first business RED**; no RED
history has been manufactured. The logout test now executes the pinned auth
middleware and official `lib/utils/logout.js` with database/SDK boundary
substitutes, proves autoRefresh=false for the submitted token, and asserts no
newToken; this is still not a cloud-side execution record.

### Steps 13–17 — SFC / SDK boundary cycle

Initial command:

`task -d miniapp test -- tests/app/auth.test.ts tests/app/session-boundary.test.ts`

Exit 1, 11 failed tests in two collected suites. The closed-marker, stale SDK
write, guard/phase and explicit not-implemented account/boundary assertions
exposed missing behavior. That run also had four unhandled test rejections and
reserved-native-tag stub warnings. **Those fixture defects and click-dispatch
failures are not counted as business RED.** Handled expected rejected Promises
and corrected test-only Vue transforms to component tagType=1, preserving slot,
disabled, click→tap and content behavior. No production plugin enters Vitest.

After implementation, one run passed 9/11, with two remaining click-dispatch
fixture failures; after the tagType correction, the same command exited 0:
11 PASS / 2 suites (1.66 s), no unhandled errors/warnings from stubs. Actual
SFC-registered onShow/onHide/onUnload callbacks are driven explicitly; no
onMounted replacement. Ordinary Vue DOM compilation is not a WeChat page-stack
or real SDK acceptance result.

Step 17 combined command:

`task -d miniapp test -- tests/domain/identity.test.ts tests/app/auth.test.ts tests/app/session-boundary.test.ts tests/contracts/uni-id-entry.test.ts`

Exit 0, 22 PASS / 4 suites (1.76 s). SDK substitute writes storage **before**
resolving Promise. Old requests/whole login flows are drained, not raced against
timeouts; cold-start marker, local storage and queued next login are asserted.

### Steps 19–20 — type / source / artifact / secret / doctor RED → GREEN

`task -d miniapp test -- tests/contracts/template-types.test.ts tests/contracts/boundaries.test.ts`

- Before gates: exit 1, five failed / three passed; specific failures were
  missing template probe, accepted value-contract import, accepted forbidden
  artifact, unimplemented secret scan and unimplemented doctor. All fixtures
  were local and generated; absence of a production build was not skipped.
- After implementation: exit 0, eight PASS / two suites (4.47 s).
- Native button `loading=true` passes without the optional volar plugin;
  `loading=123` reports **invalid-button.vue line 2, TS2322 number→boolean**.
  No plugin enablement or unchecked native-tag workaround was needed.
- Probes live under `.type-probes/<random>/`, extend actual client types, and
  remove only the exact directory created by that invocation.

Additional same-approved-seam cycles, all actually run before each fix:

| Command / added behavior | RED evidence | GREEN evidence |
| --- | --- | --- |
| `task -d miniapp test -- tests/contracts/boundaries.test.ts` — runtime relative package escape and actual account exports | 2 failed / 7 passed; both scans incorrectly resolved instead of rejecting | later full checks PASS both |
| `task -d miniapp test -- tests/app/session-boundary.test.ts tests/contracts/uni-id-entry.test.ts` — SDK rejects with errCode, and empty/non-WeChat registration source | 2 failed / 11 passed; auth mapped to UNAVAILABLE and empty wx_openid accepted | after normalization/hook hardening, targeted 4-suite run PASS 27 |
| `task -d miniapp test -- tests/app/session-boundary.test.ts` — direct facade close notification / immediate local clear, and next login while old whole login drains | 2 failed / 8 passed; old identity persisted and next call shared stale attempt | targeted 4-suite run PASS 27; final check PASS all |
| `task -d miniapp test -- tests/app/auth.test.ts tests/contracts/boundaries.test.ts` — safe retry UI and extra plugin object | 2 failed / 15 passed; missing safe failure copy and rogue object accepted | final full check PASS |
| `task -d miniapp test -- tests/contracts/boundaries.test.ts -t second_provider_root` | 1 failed / 10 filtered; second root accepted | final full check PASS |
| `task -d miniapp test -- tests/contracts/boundaries.test.ts` — authored dynamic cloud dependency and account re-export | 2 failed / 11 passed; both incorrectly accepted | final full check PASS |

One attempted `-t 'deployment_runtime|three_actual'` command was split by the
Windows Task/cmd argument layer and exited 255. This is **not** a test RED; the
full suite was then run instead. There are no committed skipped tests; filtered
counts above came solely from the explicit `-t` command.

### Complete-check iteration defects (not business RED)

- Initial lint exposed missing Node URL global declarations and Vue formatting
  warnings; fixed using patches. Third-party generated resources remain
  read-only and are excluded from authored lint/type scopes.
- Cloud JSDoc had a missing closing brace (TS1005); fixed at source and
  regenerated, never hand-edited generated policy.
- Test type environment initially picked clientDB's string projection instead
  of the narrow server platform API; replaced a conflicting global declaration
  with an imported, explicit server interface, no `any` or error suppression.
- The first actual client build failed `uni is not a function`: our added
  package `type:module` changed the official template's CJS plugin interop.
  Removed that unapproved semantic drift, and used `eslint.config.mjs` for lint
  ESM. All fixed dependency versions stayed unchanged. Rebuild succeeded.
- Artifact scan initially overmatched legitimate compiled `common/vendor.js`;
  narrowed the archive-directory predicate, retaining tests that reject actual
  vendor/test source leakage. Explicitly disabled uniStatistics per current
  official docs; no analytics entry is part of this product.
- Later flow narrowing exposed a now-unreachable redundant closing.catch call
  (TS2339); removed it rather than suppressing the type error.

### Step 21 — latest complete local result (2026-11-04)

`task -d miniapp check` exited **0**. Actual sequence:

1. Deterministic assembly `--check` PASS (no writes).
2. ESLint with zero warnings PASS.
3. Client `vue-tsc`, cloud `tsc`, tests `vue-tsc` strict/noEmit PASS.
4. **54 tests PASS in 8 suites**, Vitest 3.2.6 (latest rerun 10.32 s); no unhandled errors.
5. DCloud compiler **5.34 Vue3** WeChat build: `DONE Build complete`.
6. Source plus **actual** `dist/build/mp-weixin/` import/artifact boundary scan
   PASS; source/artifact secret scan PASS. No matched secret values are printed.

The Vite 5 CJS Node API deprecation warning is still visible, not suppressed;
it did not fail tests/build. pnpm's previously ignored dependency scripts were
not blanket-approved; the actual tests/build demonstrate the tools that ran.

Lock SHA256: `d32856b4b3c99ebe6841b65a493e688436f3688840a1ff4de52b4e461a00afc5`.
Assembly manifest: **305 generated files**, SHA256
`9204be4751d02449cfcb1abfb635743e84d120e1eac9adf5ff341e19c3ba6ac8`.
Client artifact app.js SHA256:
`087910a71491468d18e03cdbddc67dba4dfc2e194fe701335993b4b1ca575c91`;
common/vendor.js:
`40b6a024515c5103160e44601bffc1a48f9c2a9ad10cad50f7431f91fc5aa0ae`.
The built app.json registers exactly `pages/account/login` and
`pages/family/onboarding`; no third-party auth pages/router are registered.

`task -d miniapp doctor` exited **1 / NON-READY**, as required, with:
cloud-runtime-unknown, cloud-region-unknown, existing-resources-unknown,
cloud-acceptance-missing, device-acceptance-missing,
secret-configuration-unverified. It used only local filesystem reads; no HX
command or cloud/DB API, configuration mutation or secret-content read.

### Step 22 — offline preview, not upload approval

`task -d miniapp deploy:preview` exited 0: **21 resources**, all existing state
**unknown**, action **blocked-no-upload**. Inventory: two cloud objects, seven
common modules, ten Schemas, two indexes. Each has an actual file/source-tree
SHA256. `compiledCloudArtifactSha256:null` explicitly means no HX compilation.
No full-upload, force, initialization or association operation exists here.

### Independent review / unexecuted acceptance

Hand off this checkpoint for final independent review; preparation-only review
does not approve the later implementation. Steps 23–24 remain **blocked/not
executed**, including real HX dependency/TS compilation, actual WeChat code
login/logout, disabled/deleted-account and revoked-token denial, clientDB and
non-allowlisted method rejection, legal domains, privacy, weak network, real
SDK timing and device navigation. Official provider-error logging also needs
safe real-cloud inspection; local response filtering does not prove upstream
logs are redacted. No test-space account or resource was modified.

All authored UI Chinese copy is in `src/shared/copy.ts`. Product, dependency,
test and ops changes are exclusively under `miniapp/`; docs/old apps/root
dependencies were not edited. Session-only pnpm/Task tooling lives in the
approved external temp directory. No tracker writes, new Git repository,
staging, commits, pushes, deployment, association, overwrites or #2 work.

### Final provenance hardening

Read the official ZIP's end-of-central-directory comment using Node's Buffer
API: it is exactly `993791b9eb298be8013f22daa9f2efee6c50cc23`. Added a matching
revision check independently of root folder/package metadata. Actual RED:
`task -d miniapp test -- tests/contracts/vendor-assembly.test.ts -t archive_commit_comment`
exited 1 (one failed, six filtered): a synthetic archive with a changed commit
comment and correspondingly matching test digest had been accepted. The final
full check below includes the rejection fix.

Also executed the pinned official `lib/npm/index.js` merge function with only
synthetic data: registration merge retains both `mp` and the app-scoped key.
Only key names were printed; no provider call, credentials or real identity was
used. This confirms the new-user hook's mp-source check matches this revision's
registration shape, not a guessed adapter contract.

Offline preview now explicitly preserves/lists platform extension declarations
from each upstream package (including uni-cloud-redis/sms/verify/ext-storage
where declared). These declarations are **not** authorization to provision or
enable services; their availability/cost/configuration require separate review.

After that hardening, reran the entire `task -d miniapp check`: exit 0,
**54 PASS / 8 suites**, all preceding lint/types and succeeding actual build /
artifact scans PASS. Reran `task -d miniapp deploy:preview`: exit 0, same
21 blocked resources, now with explicit extension metadata. Doctor's six
NON-READY gaps above remain unchanged. `git check-ignore -v` did not identify
either upstream archive or the retained license as ignored. Final
`git status --short` still contains only `?? docs/superpowers/` and
`?? miniapp/`; no tracked legacy changes or Git operations beyond reads.

### 2026-11-04 authorized association and read-only inventory

User authorized importing the whole `miniapp/` and associating the existing
space, with no upload or database initialization. `cli project open` succeeded.
`unicloud service-space link --provider alipay --space env-00jy7289et7b`
returned provider `alipay`, space `mealie` / `env-00jy7289et7b`, and environment
`uniCloud-alipay`. No `--force`, upload, download, or initialization command was
used. Credentials returned by the IDE were not printed or written into tracked
files.

Read-only lists then returned: functions 0, schemas 0, clientDB actions 0, and
three existing common modules: `uni-config-center`, `uni-id-common`,
`uni-open-bridge-common`. Inspect did not return region or runtime. Upload
remains blocked. The user then chose a new empty space rather than replacement.
The installed CLI can only create an Aliyun trial space, so it was not used and
the provider/cloud root were not switched.

### 2026-11-04 read-only common-module comparison

The user deferred switching spaces and prohibited upload, overwrite, and database
initialization. Cloud copies were downloaded without `--force` into a temporary
project outside the repository. The original project association remained
`alipay` / `mealie` / `env-00jy7289et7b`.

These are deployed common modules, not evidenced as immutable platform builtins.
`uni-id-common` cloud metadata is 1.0.19 versus local 1.0.17. `uni-config-center`
runtime code matches 0.0.3, and its cloud copy contains no `config.json`, hooks,
or other project configuration. `uni-open-bridge-common` cloud plugin metadata
is 1.2.1 versus local plugin 1.2.0. No module was changed.

### 2026-11-04 additive upload

Continued without switching spaces, `--force`, database initialization, or
replacement of the three existing modules. HBuilderX compiled and uploaded new
TypeScript modules `home-contracts` and `home-kernel`; both type checks passed.
`account-co` compiled, then the provider returned a busy error. A non-force
retry correctly refused because `account-co` now exists. A read-only download
to a temporary directory returned its `session` source. Post-upload lists
contain `home-contracts`, `home-kernel`, and the original three modules.
`uni-id-common` remains 1.0.19. The upload warning reported cloud Node
`18.18.2` and local HBuilderX Node `18.20.0`. Region is still unknown.
`uni-id-co` was not uploaded because its package declares redis, sms, verify,
and extended-storage extensions. No cloud method was invoked at that point.

### 2026-11-04 remote client call

The user ran the associated WeChat simulator against the cloud gateway, not a
local cloud function and not `upload-and-run`. The observed invoke host was
`api-hz.cloudbasefunction.cn`. Provider inspect still has not returned a region
field; this host is only an observed gateway hint.

Reported results, redacted to codes only:

- `account-co.session` with no token returned `errCode: AUTH_REQUIRED`.
- A separate `uni-id-co` invoke returned system code `50004`: function absent
  or no active snapshot. That matches the decision not to upload it.

Request identifiers, internal addresses, and provider bodies were not stored.
This is not login, logout, revoked-token, clientDB, or device acceptance.

### 2026-11-04 uni-id-co upload side effect

The user accepted the extension-provisioning risk for `uni-id-co`. Without
`--force`, HBuilderX newly uploaded `uni-captcha`, `uni-cloud-s2s`, and
`uni-id-co`. Schema list remained empty. `uni-open-bridge-common` plugin
metadata remained 1.2.1.

A post-upload read-only download showed two protected modules had changed
anyway. `uni-id-common` is now local 1.0.17, not the previous cloud 1.0.19.
`uni-config-center` now contains the local `uni-id/config.json`; its hash
matches the local file. Secret values were not printed or copied into this
repository. No restore was attempted at that point, because that would require
`--force`.

### 2026-11-04 authorized initialization and restore

The user authorized database initialization and restoring those two modules.
`--force` was used only for those operations. The pre-check remote collection
list was empty, so initialization created tables rather than replacing existing
ones. There was no init data, schema extension, validation function, or
clientDB action to upload.

Created collections: `opendb-device`, `opendb-frv-logs`, `opendb-open-data`,
`opendb-tempdata`, `opendb-verify-codes`, `uni-id-device`, `uni-id-log`,
`uni-id-permissions`, `uni-id-roles`, `uni-id-users`. Indexes uploaded:
`opendb-device`, `uni-id-device`. Every uploaded schema has collection-level
clientDB read/create/update/delete set to false. Post-init lists match those
10 schemas and contain no extensions, validators, or clientDB actions.
Functions remained `account-co` and `uni-id-co`.

Restore uploaded the pre-upload temporary copies, not the local project tree.
A fresh download shows `uni-id-common` 1.0.19 and matching `index.js`.
`uni-config-center` again contains only `index.js` and `package.json`, with no
`config.json`. `uni-open-bridge-common` plugin metadata remains 1.2.1.
Uploader formatting changed `package.json` whitespace; parsed fields match the
pre-upload copies. Secret values were not printed.

The platform reported that it updated cloud functions depending on the restored
modules. Downloaded function trees contain no `config.json`. Secret values were
not printed, and the secret file was not re-uploaded by this session.

### 2026-11-04 simulator login and logout

The user later configured the cloud secret file outside this chat and reported
the WeChat simulator result. No token, code, or secret was stored.

- Login reached the confirmed identity page. Re-entry still showed that page.
- `uni-id-co.logout` returned `errCode` 0. The saved token was then presented
  again to `account-co.session`, which returned `AUTH_REQUIRED`.
- Re-entry after the local clear showed the login page, not the protected page.

This is simulator evidence for one successful logout and rejection of that
token. It is not disabled-account revocation, legal-domain, privacy, or
real-device acceptance.

### 2026-11-04 simulator direct-call and clientDB rejection

While logged out, the user reported the deployed checks. No response body was
stored.

- `uni-id-co.registerAdmin`, `login`, `registerUser`, and `closeAccount` each
  returned `AUTH_REQUIRED`.
- `uni-id-users` clientDB `get` and `add` each returned a permission-denial
  code. The exact provider code was not recorded.
- The direct reLaunch page result was not reported.

Update and delete were not separately called. This does not prove a disabled
account rejects an old token.

### 2026-11-04 automated devtools acceptance

Ran against the already associated WeChat devtools session for
`dist/dev/mp-weixin`, through the devtools automation socket. Cloud calls used
the client `uniCloud` gateway. The single test user was counted before any
write. Status was changed with admin JQL and restored in the same run. No
token, code, uid, openid, or user row was stored. The devtools session was
left on the login page, with no local token and the closed marker set.

- Logged-out clientDB `update` and `delete` on a nonexistent `uni-id-users`
  document each returned `TOKEN_INVALID_ANONYMOUS_USER`.
- A forged token presented to `account-co.session` returned `AUTH_REQUIRED`
  and no `newToken`. An expired-shaped token with an invalid signature did the
  same. A validly signed expired token was not created.
- `reLaunch` and `navigateTo` to `pages/family/onboarding` both reached that
  route and then returned to `pages/account/login`. The protected welcome
  string was not observed. One settled selector check found no
  `[data-protected]` node; other samples hit a page-transition selector error.
  Component text could not be read through the automation API.
- Devtools login reached `pages/family/onboarding` and cleared the closed
  marker. `account-co.session` then returned `errCode` 0 with data keys
  exactly `uid` and no `newToken`.
- While that login was active, clientDB `update` and `delete` each returned
  `PERMISSION_ERROR`. `uni-id-co.registerAdmin` returned `SYS_ERR` with the
  platform text that the user function had a logic exception, and no
  `newToken`. After logout, `registerAdmin`, `login`, and `notAMethod` returned
  the same `SYS_ERR`; `loginByWeixin` with an empty object returned
  `INVALID_INPUT`. This run did not reproduce the earlier manual
  `AUTH_REQUIRED` result for those non-exported methods. None of the calls
  succeeded.
- Admin JQL confirmed exactly one user, set `status` to 1 (`updated` 1), and
  the existing client token then received `AUTH_REQUIRED` with no `newToken`.
  Restoring `status` to 0 (`updated` 1) made `session` return `errCode` 0
  again. `logout` returned `errCode` 0 with no `newToken`, and the same client
  token then received `AUTH_REQUIRED`. A further direct open of onboarding
  returned to the login page.
- `task -d miniapp doctor` remains `NON-READY`: runtime, region, existing
  resources, cloud acceptance, device acceptance, and secret configuration are
  still unverified in `ops/acceptance.json`. No such file was written.

Still not executed: validly signed expiry, logout near the refresh threshold,
a real SDK late token write, weak-network recovery, legal-domain enforcement,
privacy configuration, provider-log redaction, and a physical device. Devtools
`project.private.config.json` has `urlCheck` false, so this run does not prove
the request domain.

### 2026-11-04 injected request failure and preview QR

Replacing `wx.request` with an immediate `request:fail` made a new
`account-co.session` return `SYS_ERR`; the failure text contained
`request:fail`, and the saved token remained. After the same replacement,
reLaunching onboarding still rendered the protected branch (`data.a === true`)
and kept the token. The page's existing cloud client did not follow that
failure, so this is not weak-network acceptance.

A later `auth.signOut()` returned `AUTH_REQUIRED`. Local storage then had no
token and the closed marker was set. That call did not confirm server
revocation. `wx.request` was restored. Devtools was returned to the login page.

`cli preview` for `dist/dev/mp-weixin` exited 0. Package total was 584.1 KB.
The QR image was left in the session temp directory and was not committed.
Official uniCloud publish guidance says a WeChat preview on a phone requires
the Alipay request domain `https://env-00jy7289et7b.api-hz.cloudbasefunction.cn`
and the socket domain `wss://env-00jy7289et7b.api-hz.cloudbasefunction.cn`.
That whitelist was not changed from here. No phone result was observed.

### 2026-11-04 phone preview showed unavailable

The same preview QR was scanned after the request and socket domains were
configured outside this session. The phone showed `网络暂不可用，请重试。`
That string is `copy.unavailable`, used when the auth phase is `unavailable`.
`restore()` and `signIn()` enter that phase for every cloud error other than
`AUTH_REQUIRED`. A missing token that reaches `account-co.session` is
`AUTH_REQUIRED` and stays on the login action, so this screen means the phone
request failed before a normal auth result.

The previewed `dist/dev/mp-weixin` bundle does contain one Alipay space. Its
request endpoint is `https://env-00jy7289et7b.api-hz.cloudbasefunction.cn` and
its socket endpoint is `wss://env-00jy7289et7b.api-hz.cloudbasefunction.cn`.
No key material was recorded. `project.config.json` has `urlCheck` true;
devtools `project.private.config.json` has `urlCheck` false, so the earlier
simulator login did not exercise the phone whitelist. This dev bundle also
probes `http://127.0.0.1` and the other local-debug addresses, then catches
that failure and continues to the cloud endpoint. Device acceptance is not
passed. Doctor remains `NON-READY`. No `acceptance.json` was written.

### 2026-11-04 user acceptance close

The user confirmed that the remaining cloud and device acceptance is complete
and authorized closing #1 on that basis. No new request body, token, WeChat
code, AppSecret, openid, user row, or screenshot was added for this close.

`ops/acceptance.json` records runtime, region, existing resources, secret
configuration, cloud acceptance, and device acceptance as verified. Cloud and
device evidence both point at this file. The previously open items—including
the physical device—are closed by that confirmation. #2 was not started.
