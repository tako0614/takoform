# Publication and change guide

This page is non-normative navigation. It is not a freeze authority, release
record, receipt, sequence, maturity record, or separately versioned document
set. The fixed contract closures are named by
[`host-api/v1.freeze.json`](host-api/v1.freeze.json) and
[`host-api/v2.freeze.json`](host-api/v2.freeze.json). The checker verifies their
bytes and Git history; this page does not establish a new freeze.

Takoform has exactly four named version streams: the Host API major and each
Form's `definitionVersion` are domain compatibility axes; Core library SemVer
and Provider SemVer are independent software-release streams. Schema IDs,
digests, packages, records, and this navigation page are not additional
version streams.

Host API v1 and v2 normative bytes are fixed. Errata and guides are
non-normative and cannot reinterpret either contract. A change to protocol
meaning requires a different API major. The v2 specification is already
defined separately from v1; it is not a pending v1 erratum or an automatic
upgrade for existing implementations. Publishing code, a schema, a package,
a Host, or a site does not advance any other stream.

The retained v1 compatibility rules are in [`versioning.md`](versioning.md);
v2 implementers use the [v2 model](host-api/v2/README.md) and
[migration guide](host-api/v2/migration.md). The Go libraries in this repository
implement v1. Public
schema identities continue to resolve through
[`release/public-schema-identities.json`](../release/public-schema-identities.json).
A green `bun run check` validates repository bytes; it does not publish, sign,
install, activate, deploy, or mutate a Resource.
