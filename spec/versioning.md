# Versioning and compatibility

Takoform has exactly two domain version axes: the Takoform API release SemVer
and each Form's `definitionVersion`. Other numbers and digests identify
namespaces, formats, schemas, evidence, parsers, clients, or distribution
artifacts. They MUST NOT be presented as additional Takoform versions or
aligned to imply one release or maturity level. Form lifecycle vocabulary is in
[`project-lifecycle.md`](project-lifecycle.md).

## Domain version axes

| Concern | Identifier | Meaning |
| --- | --- | --- |
| Takoform API release | SemVer such as `1.0.1`; only its major is projected onto a wire lane such as `forms.takoform.com/v1` | Compatible API/Core release checkpoint and wire-major compatibility |
| Form definition | SemVer in one exact FormRef's `definitionVersion` | Compatibility of that Form's portable desired-state contract |

The current release identity is **Takoform API/Core 1.0.1**. Its unchanged wire
lane is Host API v1, and the Go module
`github.com/tako0614/takoform` uses the matching `v1.0.1` tag. Core has no
independent public version stream. At runtime the API release axis exposes only
its major. API minor and patch numbers identify compatible checkpoints on that
same lane, not new discovery or route identities. A Form group is a versionless
namespace. `requiresHostApi` is a lower bound on the API wire major, not a
negotiation or a third version.

## Artifact and evidence identities

The following identities remain exact and independently released or retained,
but are not user-selectable Takoform version axes:

| Concern | Identity | What it identifies |
| --- | --- | --- |
| Specification release | an immutable release receipt | one exact Specification source snapshot |
| Form Package | envelope `$id` plus content digest | manifest parser and immutable distribution bytes |
| Interface / Binding | exact ref plus schema digest | digest-bound contract data; Form-owned compatibility follows the Form's `definitionVersion` |
| External standard | the standard owner's protocol identity | compatibility governed by that external standard |
| Core Go module | the matching API tag, beginning with `v1.0.1` | the Go distribution of that API checkpoint; never a separate Core version line |
| Other client / Provider | the artifact's own release identity | local behavior, schema, state, and migration support |
| Publisher trust | policy, root, bundle, lineage, and checkpoint identities | which exact provenance and revocation evidence an operator accepts |
| Schema / record | `$id`, format, generation, sequence, and digest | parser and append-only evidence bytes |

No `admissionVersion` exists or is needed. A stable admission report binds its
exact fields, digests, trust evidence, and capability without minting another
domain version.

## Absolute names

An absolute name identifies the lane or artifact it describes. A relative name
such as `current` or `v3` only describes a position and becomes false when the
sequence changes. New artifacts MUST use absolute names; already-published
relative names remain immutable history.

## Current wire and package identities

The current Core source carries API/Core 1.0.1 at the literal Host API v1 lane:
`forms.takoform.com/v1`. Its operation table, wire schema, discovery schema,
and support-profile schema are unchanged from the established v1 contract.
There is no fixed family roster or publisher allowlist.

The current package profile is
[`package-index-v1alpha5.schema.json`](schemas/package-index-v1alpha5.schema.json).
It is a manifest format that can carry any publisher's exact FormRef; it is not
a Form generation or a maturity channel.

## What freezes a value

An axis says what a number means; an append-only identity ledger says whether
that value may move.

| Value | Current authority |
| --- | --- |
| Specification release receipt | [`release/specification-releases.json`](../release/specification-releases.json) |
| Non-retired and verify-only schema `$id` and path | [`release/public-schema-identities.json`](../release/public-schema-identities.json) |

Withdrawal is recorded, never silent. An occupied address or digest moves to a
retired or verify-only record, keeps its bytes, and cannot be reused for another
contract. Release and schema ledgers are append-only.

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

Predecessor package profiles and locator grammars remain verify-only history.
Their bytes are accepted only to read or recover an occupied identity; they are
not aliases for the current profile.

## Core and client release identities

Core is the Go implementation distributed with the Takoform API checkpoint. API
1.0.1 and Go tag `v1.0.1` therefore name the same release, not two aligned
products. A later v1 API checkpoint and its Go tag move together. There is no
Core-only public version number to select.

A client release identity describes only that client's protocol handling, local
schema, persisted state, import behavior, and exact-identity compatibility. It
does not describe Form maturity, package publication, Host Support, Activation,
or a Service Offering.

Within a stable client major, a release MUST NOT silently reinterpret persisted
state as a different FormRef, discard a supported migration, or make an
existing valid configuration mean another contract. Removing support for an
occupied exact FormRef is a compatibility change in that client and requires
its own migration policy.

A client MAY support a mixed set of Form versions and publisher policies.
Advancing the client release MUST NOT reset, renumber, promote, or deprecate a
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

## Host API releases and lanes

Takoform API/Core 1.0.1 uses the exact Host API v1 lane, discovered at
`/.well-known/takoform/v1` with API base `/apis/forms.takoform.com/v1`. Its
wire contract is [`host-api/v1.md`](host-api/v1.md), unchanged by the 1.0.1
checkpoint. The API release does not advance Form maturity, package
publication, another client's release, or publisher trust.

`v1.0.x` is reserved for a compatible correction to the 1.0 baseline. A future
`v1.y.0` is a meaningful compatible checkpoint, not a calendar bump. It
requires exact old-client/old-Host evidence and remains on the same v1 discovery
and API roots.

API v1 uses closed request, response, error, and endpoint envelopes. Adding an
optional field can make an old decoder reject a document; adding an error can
make an old client treat a response as protocol-invalid; and adding an
endpoint member can invalidate discovery. Those additions are not compatible
by default. Compatibility requires proof that old peers never receive or must
send the new shape, normally through an already-safe explicit capability and
positive/negative old-client witnesses. If that proof cannot be made, the
change is incompatible.

An incompatible protocol requires a new API major and a new exact wire and Go
module identity together. A new API major is never a relabeling of an occupied
address. Maturity language, a Form or family change, elapsed time, or a client
release does not mint a Host lane.

## Historical Specification 1.1 and retained predecessors

Specification 1.1 is an immutable historical source receipt recorded in
[`release/specification-releases.json`](../release/specification-releases.json).
It created no Host API, Form, package, Provider, or client release.
Specification 1.0 was never published, is withdrawn, and its identity cannot
be reused.

Predecessor Host lanes, versioned family groups, package profiles, and locator
grammars remain readable only under their exact occupied identities. They MUST
NOT be relabelled, reused, or treated as current Core inputs. Repository and
release provenance stays in the append-only receipt instead of the normative
compatibility rules.

## Deprecation and revocation

Deprecation announces a migration contract: reason, successor, timing for
rejecting new create/apply, retained lifecycle behavior, and migration steps.
Legacy is the retained lifecycle state after a current line is no longer
recommended for new work. Neither operation deletes public bytes.

Security revocation is separate and append-only, as described in
[`../trust/`](../trust/). It may block creation, update, or activation while
retaining referenced bytes for observation, deletion, recovery, or explicit
operator evacuation.
