# Official content checking source

`upstream.zip` is the original uni-sec-check 2.0.2 ZIP downloaded by the user's signed-in HBuilderX official marketplace import on 2026-11-05 from [DCloud marketplace #5460](https://ext.dcloud.net.cn/plugin?id=5460). It was copied from HBuilderX's `Temp/uni_modules/cache/source/uni-sec-check@2.0.2.zip` without repacking. SHA-256: `63f5ce5f56f0d667fe10f26474b921f387bfb22ed6501ca069552c77299435b1`.

The ZIP has a flat root and no revision comment. All 19 source files are preserved byte for byte, including the original cloud package ISC declaration. The marketplace publishes a DCloud source license; this record does not replace or reinterpret either declaration. See the original source page for its license terms.

Run `node scripts/assemble-content-check.mjs` to adopt an exact official import or generate an empty target. `--check` is read-only. Unknown files, changed files, digest changes and unexpected archive paths are rejected before writes. The generated manifest records every output digest. No configuration or credentials are included.

Dependencies use the original real `file:` paths to the existing uni-config-center and uni-open-bridge-common modules. The bridge descriptor is 1.2.0 while its cloud package declares 1.0.0, and its source exposes getAccessToken. Historical cloud evidence records 1.2.1. Those descriptors have not been changed to imply compatibility; target resolution and version reconciliation remain deployment blockers. No dependency module is overwritten by this assembler.
