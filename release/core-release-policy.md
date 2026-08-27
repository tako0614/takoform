# Takoform Core release

Takoform Core is the Go module `github.com/tako0614/takoform`. Its ordinary
release identity is one stable SemVer Git tag and the GitHub Release with the
same name. GitHub supplies the source tarball and zip archive for that tag.
There is no separate Specification release stream, release ledger, signing
bundle, credential broker, deploy facade, or schema-hosting release in Core.

The repository exposes one explicit command:

```text
bun run release:core -- vMAJOR.MINOR.PATCH --dry-run
bun run release:core -- vMAJOR.MINOR.PATCH
bun run release:core -- vMAJOR.MINOR.PATCH --verify
```

`--dry-run` is read-only. It requires an exact stable SemVer tag, the owning
Git remote, a clean worktree, a missing public tag and Release, and a successful
`bun run check`. The publish form repeats the public absence check after the
gate, creates a missing lightweight tag with one ordinary non-force Git push,
reads that public tag back at the exact candidate commit, and invokes
`gh release create --verify-tag` for the asset-free Release. If an exact tag
already exists at the candidate commit but its Release does not, the same
command may complete that ordinary two-step publication. The script contains
no edit, delete, retag, force-push, asset-upload, private recovery state, or
alternate authority path. A name that points elsewhere or a Release that
already exists is immutable; repair moves forward under a later version.

`--verify` is read-only and needs no release credential. It reads the public
Git tag and GitHub Release, follows an annotated tag to its peeled commit when
necessary, and requires a non-draft, non-prerelease Release with public source
tarball and zip URLs. Publication authentication is the ordinary local `gh`
configuration of the operator who deliberately runs the publish form; the
script accepts no credential, key, ruleset ID, review record, or private state
argument.

The checked-in Quality workflow runs the same portable gate for changes on
`main`. Neither CI nor `bun run check` publishes a release. No production host,
account, route, schema origin, or cutover is part of this release.
