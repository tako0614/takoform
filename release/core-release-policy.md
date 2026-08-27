# Takoform API and Core release

The current API/Core release is **1.0.1**. The Go module
`github.com/tako0614/takoform@v1.0.1`, API-v1 Git tag `v1.0.1`, and matching
GitHub Release name the same published identity. GitHub supplies the source
tarball and zip archive for that tag. Core has no separate public version
stream.

The repository exposes one release entrypoint:

```console
bun run deploy -- --contract
bun run deploy -- core v1.0.1 --verify
```

For a new compatible API v1 checkpoint, replace `v1.MINOR.PATCH` with the
exact intended version:

```console
bun run deploy -- core v1.MINOR.PATCH --dry-run
bun run deploy -- core v1.MINOR.PATCH
bun run deploy -- core v1.MINOR.PATCH --verify
```

`--contract` describes the surface without side effects. A release argument
must be an exact stable SemVer tag on the current API v1 line. The literal
wire identity remains `forms.takoform.com/v1`.

## Create-only publication

`--dry-run` is read-only. It checks the owning repository and remote, a clean
worktree, absence of the requested public tag and GitHub Release, and a
successful `bun run check`.

Publication repeats the public-absence check after the gate. If the tag is
missing, it creates that tag with one ordinary non-force push, reads it back at
the exact source commit, and creates the matching GitHub Release. An existing
tag at the exact source commit may complete a missing Release; a tag pointing
elsewhere or an existing Release is an immutable conflict. The entrypoint has
no overwrite, delete, retag, force-push, asset-upload, or alternate publication
path.

## Read-only verification

`--verify` reads the public tag and GitHub Release without publishing. It
requires the tag to resolve to the released commit and the Release to be
non-draft, non-prerelease, and expose public source tarball and zip URLs. It
also confirms that the exact module identity is consumable by a public Go
consumer and that the representative `formpackage`, `hostclient`, `snapshot`,
and `trust` packages build and test.

The portable `bun run check` gate is read-only and does not publish a release.
The entrypoint refuses a non-v1 release tag, a conflicting occupied identity,
or a failed gate; repair proceeds under a later exact identity rather than
rewriting published bytes.
