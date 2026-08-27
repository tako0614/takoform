# Takoform API and Core release

Takoform API 1.0.0 and the Go module
`github.com/tako0614/takoform@v1.0.0` are one release. The ordinary release
identity is one API-v1 SemVer Git tag and the GitHub Release with the same
name. GitHub supplies the source tarball and zip archive for that tag. There is
no Core `v0.1.0`, separate Core version stream, future numbered Specification
stream, release ledger, signing bundle, credential broker, or schema-hosting
release.

The repository exposes one public entrypoint and one surface:

```text
bun run deploy -- --contract
bun run deploy -- core v1.MINOR.PATCH --dry-run
bun run deploy -- core v1.MINOR.PATCH
bun run deploy -- core v1.MINOR.PATCH --verify
```

`--contract` is side-effect-free. The tiny deploy entrypoint delegates only
the `core` surface to the create-only internal release implementation.
`--dry-run` is read-only. It requires an exact stable SemVer tag on the API v1
line, the owning Git remote, a clean worktree, a missing public tag and Release,
and a successful `bun run check`. The publish form repeats the public absence
check after the gate, creates a missing lightweight tag with one ordinary
non-force Git push, reads that public tag back at the exact source commit, and
invokes `gh release create --verify-tag` for the asset-free Release. If an
exact tag already exists at the source commit but its Release does not, the
same command may complete that ordinary two-step publication. The script
contains no edit, delete, retag, force-push, asset-upload, private recovery
state, or alternate authority path. A name that points elsewhere or a Release
that already exists is immutable; repair moves forward under a later version.

`--verify` is read-only and needs no release credential. It reads the public
Git tag and GitHub Release, follows an annotated tag to its peeled commit when
necessary, and requires a non-draft, non-prerelease Release with public source
tarball and zip URLs. It then creates a fresh temporary consumer module and
fresh Go module/build caches, resolves the exact
`github.com/tako0614/takoform@v1.MINOR.PATCH` identity with
`GOPROXY=direct`, confirms the resolved module version, and runs a tiny Go test
that imports `formpackage`, `hostclient`, `snapshot`, and `trust`. Temporary
consumer state is removed on both success and failure, and Go diagnostics are
preserved. The internal release implementation is import-only; `bun run deploy`
is the sole CLI.

Publication authentication is the ordinary local `gh` configuration of the
operator who deliberately runs the publish form; the script accepts no
credential, key, ruleset ID, review record, or private state argument. The
first publishable identity is exactly `v1.0.0`; both the public entrypoint and
internal helper reject `v0.x` and reject `v2.x` until an evidenced incompatible
API release moves both the wire and Go module major.

The checked-in Quality workflow runs the same portable gate for changes on
`main`. Neither CI nor `bun run check` publishes a release. No production host,
account, route, schema origin, or cutover is part of this release.
