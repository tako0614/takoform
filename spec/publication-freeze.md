# Publication and change guide

This page is non-normative navigation. It is not a freeze authority, release
record, receipt, sequence, maturity record, or independently versioned
Specification. The one-time Host API v1 closure is named only by
[`host-api/v1.freeze.json`](host-api/v1.freeze.json), and the checker anchors it
to that manifest's first-add Git commit.

Takoform has exactly four named version streams: the Host API major and each
Form's `definitionVersion` are domain compatibility axes; Core library SemVer
and Provider SemVer are independent software-release streams. Schema IDs,
digests, packages, records, and this navigation page are not additional
version streams.

Host API v1 normative bytes never change. Errata are non-normative and cannot
reinterpret v1. A normative or behavioral change requires a future Host API v2
proposal. Publishing code, a schema, a package, a Host, or a site does not
advance any other stream.

Exact compatibility rules are in [`versioning.md`](versioning.md). Public
schema identities continue to resolve through
[`release/public-schema-identities.json`](../release/public-schema-identities.json).
A green `bun run check` validates repository bytes; it does not publish, sign,
install, activate, deploy, or mutate a Resource.
