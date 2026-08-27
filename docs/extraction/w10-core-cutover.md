# W10 Core extraction and authority cutover

This document records the non-destructive extraction that establishes
`github.com/tako0614/takoform` as the final neutral Core owner. It is an
extraction receipt, not a replacement for the immutable Specification 1.1
release receipt.

## Fixed source identities

- source repository: `https://github.com/tako0614/terraform-provider-takoform.git`
- canonical W09 completion commit: `1fa34160a4ed152443b4ea424a324f7677716e36`
- canonical W09 tree: `7e4a2578af2f50b826fba1004fdd4e430c761314`
- filtered history head before the module cutover:
  `f3ed98a9b967cfed130359a51f56badf11188bd4`
- filtered history tree before the module cutover:
  `96a19c39346f846bc60c527809c60b900dfd5d4b`
- `git-filter-repo` version: `a40bce548d2c`
- complete commit map:
  [`filter-repo-commit-map.txt`](filter-repo-commit-map.txt)
- commit-map SHA-256:
  `4a16c5344a8ed30326e5f9015206a57005796a06043c691271061642e139e995`
- complete 371-path byte map:
  [`source-path-map.json`](source-path-map.json)
- path-map SHA-256:
  `6542239003656464f8c78f87dca7d37f5e2b2ae358a49734d8f48a939bc52dad`

The extraction started from a main-only, no-tag clone. No Provider, Form,
admission, or Specification tag is copied to the new repository.

## Immutable Specification 1.1 history

Specification 1.1 remains the release published by the old repository. It is
not recreated or retagged here.

- normative source commit: `00ae5ee4e2ea2eb62ea796499a93081374dc36b9`
- release/evidence commit: `35c03a76326c808e859aa77172e086f15a2aeb5d`
- annotated tag: `specification/1.1`
- tag object: `e2c1ba71766a6b25cae0826df99c8906a7f3f20b`
- source snapshot:
  `sha256:23a9b14dc79f46fae632624fc5c442f947f63565e9d7f9d0a614598b5027ae03`
- evidence asset:
  `sha256:6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84`
- immutable GitHub Release ID: `377480828`

The imported receipt remains byte-for-byte bound to those identities. W10
adds a separate authority-transfer receipt; it never changes the 1.1 receipt.

## Extraction command

The source was cloned with only `refs/heads/main`, with tags disabled. The
following path closure was then retained with `git filter-repo --force`:

```text
.github/workflows/quality.yml
.gitignore
AGENTS.md
LICENSE
README.md
README.en.md
package.json
bun.lock
go.mod
go.sum
docs/source-boundary-inventory.md
spec/
formpackage/
internal/currentformsnapshot/
internal/clientv3/
internal/portableconformancev3/
conformance/takoform-v1/generic.json
conformance/takoform-v1/generic-host/
conformance/revocation-checkpoint-v1/
cmd/form-package/
cmd/portable-host-conformance/
cmd/reference-host/
release/specification-releases.json
release/specification-compatibility.json
release/public-schema-identities.json
release/published-document-lanes.json
release/trust/trusted-root.json
scripts/public-schema-manifest.mjs
scripts/public-schema-manifest.test.mjs
scripts/publication-evidence.mjs
scripts/publication-evidence.test.mjs
scripts/schema-publication-guard.mjs
scripts/schema-publication-guard.test.mjs
scripts/specification-compatibility.mjs
scripts/specification-compatibility.test.mjs
scripts/specification-release.mjs
scripts/specification-release.test.mjs
```

This broad closure preserves source lineage for files that require a symbol
split. The module-cutover commit removes Provider, official-family, Edge
runtime, publisher-operation, and mixed-ledger content from the current tree.
Historical presence in an extracted commit does not grant current authority.

## Current ownership after cutover

Core owns:

- the normative Specification and complete active/verify-only neutral schema
  closure;
- `formpackage`, the public immutable Snapshot compiler, the neutral Host API
  client, generic conformance, and their SDK/CLI surfaces;
- caller-supplied publisher/trust policy formats and offline verification;
- the active and verify-only public-schema identity ledger as a logical,
  platform-neutral contract; the numbered Specification writer ended with the
  W09 1.1 receipt.

Core does not own:

- official or external Form source, packages, signing policy, or release
  workflows;
- Terraform/OpenTofu Provider schema, state, import, codecs, keys, releases, or
  Registry evidence;
- Host installation, implementation support, activation, Resource lifecycle,
  backend capacity, credentials, or production operations;
- a central catalog, ambient trust grant, official-family shortcut, or API v2.

Historical Host and Form Package schemas remain byte-exact `verify-only`
compatibility inputs. They do not authorize new publication or Host support.

## Authority transfer order

1. Build and verify the extracted repository with all future writers disabled.
2. Record the complete source/path/blob/digest map and the final Core commit.
3. Land forward tombstone T at predecessor commit
   `220d37b284d8288e6e12d31375ecfdca6a5f15c5`, freezing its
   Specification/schema ledgers and disabling both old writers.
4. Land one direct cleanup child C that deletes the dormant numbered
   Specification writer and every platform-specific schema hosting surface,
   dependency, credential lane, and authority record from Core.
5. Remove old workflow/OIDC/tag-creation authority.
6. When separately requested, publish Takoform API 1.0.0 and the matching Core
   SDK/CLI module tag `v1.0.0` as one release through
   `bun run deploy -- core v1.0.0`, then perform its public tag and
   source-archive readback. There is no preceding Core `v0.1.0` or independent
   Core version line.

A permanent zero-writer state for numbered Specifications is intentional. A
dual-writer interval is forbidden. Published Provider and Specification
identities are never rewritten. Core carries logical schema identities, not a
hosting or cutover claim, and there is no activation-only A between P and C.
The ordinary release entrypoint is a small facade over the create-only release
helper; the extracted broker, ledger, and numbered Specification machinery do
not return.
