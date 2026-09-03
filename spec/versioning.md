# Versioning and compatibility

Takoform has exactly four named version streams. The Host API major lane and
each Form's `definitionVersion` are domain compatibility axes. Core library
SemVer and Provider SemVer are independent software-release streams. Other
numbers and digests identify namespaces, formats, schemas, evidence, parsers,
clients, or distribution artifacts. They MUST NOT be presented as additional
Takoform versions or aligned to imply one release.

## Domain version axes

| Concern | Identifier | Meaning |
| --- | --- | --- |
| Host API lane | an exact wire major such as `forms.takoform.com/v1` | Compatibility of Host discovery, routes, and closed wire documents |
| Form definition | SemVer in one exact FormRef's `definitionVersion` | Compatibility of that Form's portable desired-state contract |
| Core library | independent SemVer | Compatibility of SDK, CLI, verifier, compiler, and client software |
| Provider | independent SemVer | Compatibility of Terraform/OpenTofu schema, state, import, diagnostics, and mappings |

The current Host lane is exactly `forms.takoform.com/v1`. Its normative bytes
never change. Errata are non-normative and cannot reinterpret the lane; every
normative or behavioral change requires a future Host API v2 proposal. A
software library or Provider may release on its own SemVer cadence, but that
number is not a Host API or Form version. A Form group is a versionless
namespace. `requiresHostApi` is a lower bound on the Host API wire major, not a
negotiation or another version stream.

## Artifact and evidence identities

The following identities remain exact and independently released or retained,
but are not user-selectable Takoform version axes:

| Concern | Identity | What it identifies |
| --- | --- | --- |
| Form Package | envelope `$id` plus content digest | manifest parser and immutable distribution bytes |
| Interface / Binding | exact ref plus schema digest | digest-bound contract data; Form-owned compatibility follows the Form's `definitionVersion` |
| External standard | the standard owner's protocol identity | compatibility governed by that external standard |
| Other software / client | the artifact's own release identity | local behavior and compatibility; it does not add a Takoform version stream |
| Publisher trust | policy, root, bundle, lineage, and checkpoint identities | which exact provenance and revocation evidence an operator accepts |
| Schema / record | `$id`, format, generation, sequence, and digest | parser and append-only evidence bytes |

No `admissionVersion` exists or is needed. An admission report binds its exact
fields, digests, trust evidence, and capability without minting another domain
version.

The current revocation statement and checkpoint identity
`trust.forms.takoform.com/v1`, its reserved genesis
`checkpointVersion: 0.0.0`, and the retained v1alpha1 trust identities are data
formats and record identities consumed by implementations. They do not create another
Host discovery lane, API route, or domain version axis. The occupied
`trust.forms.takoform.com/v1alpha1` schema bytes remain readable rather than
being overwritten to admit genesis.

A library release that adds support for a data format does not alter the Host
API v1 wire documents. Publishing code, a schema projection, and a publisher
record are separate owner actions; none implicitly advances the API or a Form.

## Absolute names

An absolute name identifies the lane or artifact it describes. A relative name
such as `current` or `v3` only describes a position and becomes false when the
sequence changes. New artifacts MUST use absolute names; already-published
relative names remain immutable history.

## Current wire and package identities

The current Host API lane is the literal `forms.takoform.com/v1`. Its operation
table, wire schema, discovery schema, and support-profile schema define that
exact contract. There is no fixed family roster or publisher allowlist, and no
software artifact version is projected into a Host address.

The current package profile is `package-index-v1alpha5.schema.json`. It is an
exact schema root in the frozen Host API v1/common-model closure because Hosts
install and resolve its data-only packages. Its format identity is not a Form
`definitionVersion` or another version stream, and its bytes cannot change
within v1.

## What freezes a value

An axis says what a number means; an append-only identity ledger says whether
that value may move.

| Value | Current authority |
| --- | --- |
| Host API v1 normative prose and machine/schema closure | [`spec/host-api/v1.freeze.json`](host-api/v1.freeze.json), anchored to the manifest's first-add Git commit |
| Non-retired and verify-only schema `$id` and path | [`release/public-schema-identities.json`](../release/public-schema-identities.json) |

Withdrawal is recorded, never silent. An occupied address or digest moves to a
retired or verify-only record, keeps its bytes, and cannot be reused for another
contract. Identity ledgers are append-only.

## Form groups

A FormRef group is a versionless reverse-DNS identifier controlled by its
publisher. All publishers use the same grammar;
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
publisher's package release cadence is independent of API, Form, Host, and
client releases. A package digest does not carry an implicit SemVer;
the Form's `definitionVersion` is the compatibility version for desired state.

Predecessor package profiles and locator grammars remain verify-only history.
Their bytes are accepted only to read or recover an occupied identity; they are
not aliases for the current profile.

## Software and client release identities

A library, client, or Provider tag versions only that software artifact and
does not mint or select a Host lane. Its major is not required to equal the Host
wire major. Host compatibility is evaluated from the exact Host API lane and
contract documents that the software supports.

A client release identity describes only that client's protocol handling, local
schema, persisted state, import behavior, and exact-identity compatibility. It
does not describe package publication, Host Support, Activation, or a Service
Offering.

Within a client major, a release MUST NOT silently reinterpret persisted
state as a different FormRef, discard a supported migration, or make an
existing valid configuration mean another contract. Removing support for an
occupied exact FormRef is a compatibility change in that client and requires
its own migration policy.

A client MAY support a mixed set of Form versions and publisher policies.
Advancing the client release MUST NOT reset or renumber a Form. Changing a Form
does not require a client release when the client already preserves that exact
identity and can carry its data correctly.

## Form definitionVersion SemVer

### `0.x`

The first public version of a Form line is `0.1.0`.

- A breaking semantic or schema change increments the minor version and resets
  the patch version.
- A compatible addition increments the minor version.
- A compatible correction that leaves the accepted desired contract unchanged
  increments the patch version.

A `0.x` identity is never overwritten. A breaking correction mints a new exact
identity instead of editing occupied bytes. A publisher MAY withdraw a `0.x`
identity, but withdrawal keeps its bytes and records its retirement.

### `1.x` and later

The initial identity in a `1.x` major is `1.0.0` for a new kind. The major's
compatibility commitment is defined by the rules below; no separate Takoform
status record is involved.

- A patch preserves desired schema and portable semantics.
- A minor adds optional data or relaxes a constraint without changing the
  meaning of previously valid desired documents.
- A major may remove data, tighten a constraint, change meaning, or require
  replacement or explicit migration.

When compatibility cannot be proved, the change MUST be treated as breaking.

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
predecessor Form whose historical version is greater than zero remains bound to
its recorded identity, and no current tooling may renumber it.

## Host API lanes

The exact Host API v1 lane is discovered at `/.well-known/takoform/v1` with API
base `/apis/forms.takoform.com/v1`. Its wire contract is
[`host-api/v1.md`](host-api/v1.md). Releasing a library or client does not alter
those addresses, publish a package, release another client, or change publisher
trust.

API v1 uses closed request, response, error, and endpoint envelopes. Adding an
optional field can make an old decoder reject a document; adding an error can
make an old client treat a response as protocol-invalid; and adding an
endpoint member can invalidate discovery. Those additions are not compatible
by default. Compatibility requires proof that old peers never receive or must
send the new shape, normally through an already-safe explicit capability and
positive/negative old-client witnesses. If that proof cannot be made, the
change is incompatible.

An incompatible protocol requires a new Host API major and new exact wire
identities. It does not require a software implementation to adopt the same
numeric major. A new Host API major is never a relabeling of an occupied address.
A Form or family change, elapsed time, or a software artifact release does not
mint a Host lane.

## Retained predecessors

Predecessor Host lanes, versioned family groups, package profiles, and locator
grammars remain readable only under their exact occupied identities. They MUST
NOT be relabelled, reused, or treated as current inputs. Repository provenance
stays in append-only internal records instead of creating another public
version stream.

## Revocation and retained identities

The current trust profile and v1 revocation statement/checkpoint schemas are
exact roots in the frozen Host API v1/common-model closure. Revocation evidence
remains an append-only security record rather than a version stream. It may
block creation, update, or activation while retaining referenced bytes for
observation, deletion, recovery, or explicit operator evacuation.
