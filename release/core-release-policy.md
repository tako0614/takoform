# Takoform Core module release

Core **v1.1.0** is a software/module artifact release. The Go module
`github.com/tako0614/takoform@v1.1.0`, Git tag `v1.1.0`, and GitHub Release
titled exactly `Takoform Core v1.1.0` name that one published artifact. GitHub
supplies the source tarball and zip archive for the tag.

Core SemVer does not version the Host API. The Host wire identity remains
`forms.takoform.com/v1`; there is no Host API v1.1 discovery lane or route.

The repository exposes one release entrypoint:

```console
bun run deploy -- --contract
bun run deploy -- core v1.1.0 --verify
```

For a Core module artifact release, replace `v1.MINOR.PATCH` with the exact
intended version:

```console
bun run deploy -- core v1.MINOR.PATCH --dry-run
bun run deploy -- core v1.MINOR.PATCH
bun run deploy -- core v1.MINOR.PATCH --verify
```

`--contract` describes the surface without side effects. A release argument
must be an exact stable SemVer tag on the current Core module v1 line. This
constraint is about the Go module's current major and does not imply a matching
Host API minor version.

## New publication and interrupted-release reconciliation

`--dry-run` is read-only. It checks the owning repository and remote, a clean
worktree, the exact public tag before public `refs/heads/main`, absence of the
GitHub Release, and a successful `bun run check`. Its `publicationAction` is
either `create` or `reconcile-existing-tag`. A reviewed remote branch may pass
the create checks before merge, but the result separates `gatePassed: true`
from `publicMainMatchesHead: false` and `publishReady: false`.

For `create`, publication refuses before the gate unless exact local HEAD
already equals the credential-free public `refs/heads/main`, and repeats that
main read plus the Release-absence check after the gate. It then creates the
missing tag with one ordinary non-force push, reads it back at the exact source
commit, and creates the matching exact-title GitHub Release.

For `reconcile-existing-tag`, clean local HEAD must equal the already-public
tag commit and the Release must be absent before and after the gate. Public main
may have advanced because reconciliation creates no Git identity. The tool
re-reads the exact tag after the gate and refuses if it moved or disappeared;
it never pushes, recreates, or changes that tag. A tag pointing elsewhere or an
existing Release is an immutable conflict. The entrypoint has no overwrite,
delete, retag, force-push, asset-upload, or alternate publication path.

## Read-only verification

`--verify` reads the immutable public tag and GitHub Release without publishing
and remains usable from a later local HEAD. It requires the Release title to be
`Takoform Core v1.1.0`, be non-draft and non-prerelease, and expose public
source tarball and zip URLs. The publication post-condition additionally pins
that readback to the exact candidate commit. Both modes confirm that the exact
module identity is consumable by a public Go consumer and that the
representative `formpackage`, `hostclient`, `snapshot`, and `trust` packages
build and test.

Historical tags retain their occupied titles: v1.0.0 requires
`Takoform API 1.0.0` and v1.0.1 requires `Takoform API 1.0.1`. This read
compatibility does not restore API SemVer as a current version axis; v1.1.0 and
later Core artifacts use the `Takoform Core v...` title.

The portable `bun run check` gate is read-only and does not publish a release.
The entrypoint refuses a non-v1 release tag, a conflicting occupied identity,
or a failed gate; repair proceeds under a later exact identity rather than
rewriting published bytes.
