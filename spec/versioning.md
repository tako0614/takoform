# Versioning and compatibility

Takoform has independent version axes. A protocol lane, Form, package,
Interface, Binding, client, and publisher policy answer different compatibility
questions; their numbers MUST NOT be aligned to imply one release or maturity
level. Form lifecycle vocabulary is in
[`project-lifecycle.md`](project-lifecycle.md).

## Version axes

| Concern | Identifier | Meaning |
| --- | --- | --- |
| Host API | An exact API lane such as `forms.takoform.com/v1` | Wire envelope, discovery, and lifecycle compatibility |
| Form group | A versionless reverse-DNS group in a FormRef | Namespace boundary chosen by a publisher |
| Form | SemVer in an exact FormRef | Compatibility of one portable desired-state contract |
| Form Package | Exact envelope and content digest | Immutable distribution of one Form and its data |
| Interface / Binding | Exact ref plus schema digest | Immutable operation and capability contracts |
| Client | The client's own release identity | Local schema, state, and migration behavior |
| Publisher policy | Caller-supplied provenance and trust inputs | Which signatures and source identities an operator accepts |

### Absolute names

An absolute name identifies the lane or artifact it describes. A relative name
such as `current` or `v3` only describes a position and becomes false when the
sequence changes. New artifacts MUST use absolute names; already-published
relative names remain immutable history.

The predecessor repository once moved a conformance corpus between relative
paths. That incident is retained as a history lesson, not as a current path or
runner. The immutable source is available at the
[W09 commit](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36),
and the extracted ledger records the old lane declarations in
[`docs/extraction/history/published-document-lanes.json`](../docs/extraction/history/published-document-lanes.json).

## Current and retained identities

The current Core source carries the literal Host API v1 candidate
`forms.takoform.com/v1` and the versionless family-group grammar. It does not
carry a fixed family roster. Publishing a Specification release does not
publish a Host lane or promote a Form.

The current package profile is
[`package-index-v1alpha5.schema.json`](schemas/package-index-v1alpha5.schema.json).
It is a manifest format that can carry any publisher's exact FormRef; it is not
a Form generation or a maturity channel.

The following are retained predecessor identities. They remain readable only
for the exact bytes and contracts that were published at the time and MUST NOT
be relabelled or reused:

- the Host API `forms.takoform.com/v1beta1` lane;
- versioned family groups such as `edge.forms.takoform.com/v1beta1`;
- the withdrawn pre-Beta Host lanes and their package profiles; and
- any predecessor conformance or publication path named by those documents.

The old repository's [immutable specification tree](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36/spec)
and the local extracted history preserve those facts. They are not current
Core inputs or publisher authority.

## What freezes a value

An axis says what a number means; an append-only identity ledger says whether
that value may move.

| Value | Current authority |
| --- | --- |
| Specification release | [`release/specification-releases.json`](../release/specification-releases.json) |
| Active and verify-only schema `$id` and path | [`release/public-schema-identities.json`](../release/public-schema-identities.json) |
| Pre-extraction served-document declarations | [`docs/extraction/history/published-document-lanes.json`](../docs/extraction/history/published-document-lanes.json) |
| Retained predecessor bytes | Immutable git history and the predecessor release identity |

Withdrawal is recorded, never silent. An occupied address or digest moves to a
retired/verify-only record, keeps its bytes, and cannot be reused for another
contract. The schema ledger is append-only; the extracted W09 ledger is a
historical receipt and is not regenerated.

## Form groups

A FormRef group is a versionless reverse-DNS identifier controlled by its
publisher. Project-maintained and independent publishers use the same grammar;
provenance is evaluated by the operator's trust policy, not by a built-in
namespace list. A group is one component of identity and is resolved before
`kind`, `definitionVersion`, and `schemaDigest`.

Host Support, Form Activation, Service Offering, and client support records
refer to exact identities but are not version streams. Changing one of those
facts MUST NOT silently change a Form or protocol identity.

## Form Package identity

The package envelope is a manifest format, not a version axis. A package carries
one exact FormRef, a closed data-only inventory, and its canonical digest. The
Form Definition's `schemaDigest` and the package's content digest are separate
identities. Archive headers and compression are transport and MUST NOT enter
either digest.

The package profile may evolve only when its validation contract changes. A
publisher's package release cadence is independent of Specification, Form,
Host, and client releases. A package digest does not carry an implicit SemVer;
the Form's `definitionVersion` is the compatibility version for desired state.

The predecessor package profiles and locator grammars remain verify-only
history. Their bytes are accepted only to read or recover an occupied identity;
they are not aliases for the current profile.

## Client versions are independent

A client release describes only that client's protocol handling, local schema,
persisted state, import behavior, and exact-identity compatibility. It does not
describe Form maturity, package publication, Host Support, Activation, or a
Service Offering.

Within a stable client major, a release MUST NOT silently reinterpret persisted
state as a different FormRef, discard a supported migration, or make an
existing valid configuration mean another contract. Removing support for an
occupied exact FormRef is a compatibility change in that client and requires
its own migration policy.

A client MAY support a mixed set of Form versions and publisher policies.
Advancing the client version MUST NOT reset, renumber, promote, or deprecate a
Form. Changing a Form does not require a client release when the client already
preserves that exact identity and can carry its data correctly.

## Form versions

### Proposal

A Proposal has no public version. It MAY change incompatibly or be withdrawn
without reserving a FormRef.

### Experimental `0.x`

The first reproducible public version of a Form line is `0.1.0`.

- A breaking semantic or schema change increments the minor version and resets
  the patch version.
- A compatible addition increments the minor version.
- A compatible correction that leaves the accepted desired contract unchanged
  increments the patch version.

A `0.x` identity is never overwritten. A breaking correction mints a new exact
identity instead of editing occupied bytes. A `0.x` identity MAY be withdrawn
before Stable, but withdrawal keeps its bytes and records its retirement.

### Stable `1.x+`

A Form MAY begin a stable major only after the evidence and explicit decision
required by [`project-lifecycle.md`](project-lifecycle.md). The initial stable
identity is `1.0.0` for a new kind.

- A patch preserves desired schema and portable semantics.
- A minor adds optional data or relaxes a constraint without changing the
  meaning of previously valid desired documents.
- A major may remove data, tighten a constraint, change meaning, or require
  replacement or explicit migration.

When compatibility cannot be proved, the change MUST be treated as breaking or
remain a Proposal.

## State and exact identity

A client that persists state binds each resource to the exact FormRef under
which it was applied. When a Form line advances, existing state remains bound
to the older identity and the client MUST continue to address it under that
identity or fail closed. It MUST NOT query, update, or delete it under a
different FormRef merely because the kind or name is the same.

Changing a group re-identifies every member because the group is part of the
digest-bound Definition. A client must therefore treat a group rename as new
identities and provide explicit migration rather than silently substituting a
group.

An occupied FormRef MUST never be reused for different bytes. A retained
predecessor Form whose historical version is greater than zero is not thereby a
current Stable Form, and no current tooling may renumber it.

## Host API lanes

The current source candidate is the exact Host API v1 lane, discovered at
`/.well-known/takoform/v1` with API base `/apis/forms.takoform.com/v1`. Its
wire contract is [`host-api/v1.md`](host-api/v1.md). A Host lane is independent
of Form maturity, package publication, client versions, and publisher trust.

A new lane is minted only for a changed protocol contract or an explicitly
evidenced protocol graduation. It is a new exact identity, never a relabeling
of an occupied address. A Form Family change or client release alone does not
mint a Host lane.

The predecessor Host lanes, their discovery paths, and their operation tables
remain retained history. They are identified in the extracted W09 ledger and
the [immutable predecessor source](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36/spec/host-api);
they do not authorize a new lane or a current runner.

## Deprecation and revocation

Deprecation announces a migration contract: reason, successor, timing for
rejecting new create/apply, retained lifecycle behavior, and migration steps.
Legacy is the retained lifecycle state after a current line is no longer
recommended for new work. Neither operation deletes public bytes.

Security revocation is separate and append-only, as described in
[`../trust/`](../trust/). It may block creation, update, or activation while
retaining referenced bytes for observation, deletion, recovery, or explicit
operator evacuation.
