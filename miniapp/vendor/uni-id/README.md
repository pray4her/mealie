# Read-only official identity source

`upstream.zip` is the complete original official fixed-revision archive, bytes
unchanged. Source, revision and SHA256 are locked in `lock.json`. The actual
official archive endpoint provides ZIP; this intentionally replaces the plan's
proposed tar.gz filename without renaming formats or altering upstream files.

Official source provenance: GitCode's public download button uses
`https://raw.gitcode.com/<namespace>/<repo>/archive/refs/heads/<ref>.zip`;
the ref here is the complete approved commit, never a moving branch. The ZIP's
Git commit comment is exactly `993791b9eb298be8013f22daa9f2efee6c50cc23`;
assembly validates that independently of the root folder/version fields. No clone,
new Git repository, local credentials, or user project was used as source.

All upstream package metadata, readmes, and license files remain in this full
archive. The explicit `uni-captcha/.../LICENSE.md` is retained in generated
resources. The archive does not declare a single repository-wide LICENSE;
we do not invent a replacement license or remove the root AGPL obligations.
Inspect upstream plugin declarations before redistributing/deploying.

Run `node scripts/assemble-uni-id.mjs` from miniapp; `--check` compares without
writing. Only generated files tracked by the assembly manifest may be updated;
unknown or user-modified files are never overwritten. No deploy action occurs.
