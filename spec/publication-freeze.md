# Publication and change policy

The current API/Core release is **1.0.1** on the unchanged literal Host API v1
lane, `forms.takoform.com/v1`. The matching Go module tag is `v1.0.1`.

Takoform has exactly two domain version axes:

| Axis | Meaning |
| --- | --- |
| API release SemVer | API/Core compatibility checkpoint; only the major selects a wire lane |
| Form `definitionVersion` | Compatibility of one Form's portable desired-state contract |

Form groups are namespaces. Package, schema, Interface/Binding, trust, client,
and release-record identities identify their own bytes or evidence and do not
create another Takoform version axis.

## Immutable identities

The active and verify-only schema identities are recorded in
[`release/public-schema-identities.json`](../release/public-schema-identities.json).
The append-only release receipt and signed record chain are
[`release/specification-releases.json`](../release/specification-releases.json),
[`release/record-head.json`](../release/record-head.json), and
[`release/record-prefix-chain.json`](../release/record-prefix-chain.json).
Each entry binds an exact path, identity, and digest; withdrawal retains the
bytes and prevents reuse of the occupied identity.

## Historical Specification receipt

The first numbered Specification release, **Specification 1.1**, is immutable
history. Its exact source snapshot, tag, release, and evidence are recorded in
[`release/specification-releases.json`](../release/specification-releases.json).
Specification 1.0 was never published, is withdrawn, and cannot be reused.
The receipt does not publish or promote an API lane, Form, package, Provider,
Host, or client release.

## Change policy

Changes to a current contract update the relevant source, schemas, fixtures,
compatibility notes, and evidence together. Published bytes and occupied
identities are never overwritten, retagged, or silently relabelled; a breaking
change receives a new exact identity and the append-only ledgers retain the
predecessor.

The current API/Core source and the Host API v1 wire remain separate from Form
maturity, package publication, Host support, client releases, and commercial
Offering decisions. A green `bun run check` validates the repository; it does
not publish, sign, install, activate, deploy, or mutate a Resource.

Normative contract links and authority classification are maintained in
[`spec/README.md`](README.md). Compatibility details are in
[`versioning.md`](versioning.md).
