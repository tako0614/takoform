# Takoform portable specification

This directory is the family-neutral contract surface for Takoform. It defines
portable identities, data-only Form Packages, immutable Snapshot compilation,
Host lifecycle messages, trust inputs, and conformance language. It does not
define an official Form roster, a Terraform Provider, a Host implementation,
backend placement, credentials, activation, billing, or a catalog.

Requirement keywords and conformance classes are defined in
[`conformance.md`](conformance.md). Independent version axes and compatibility
rules are defined in [`versioning.md`](versioning.md). Form maturity and the
separate authored, published, installed, supported, activated, provisioned,
client-supported, and offered facts are defined in
[`project-lifecycle.md`](project-lifecycle.md).

## Publication status

Takoform Specification 1.1 is the first numbered release. It was published as
an immutable source snapshot by the predecessor repository before Core
ownership moved. Its exact source commit, annotated tag object, release,
snapshot digest, and asset digest remain in the imported append-only
[`Specification release ledger`](../release/specification-releases.json).
Identity 1.0 was never published, is withdrawn, and is never reused.

The current repository tree is an unreleased post-1.1 draft. A source change in
this tree does not alter the published 1.1 snapshot and does not itself publish
any protocol, Form, package, SDK, Provider, support, activation, or Offering
fact. The current publication and writer boundary is
[`publication-freeze.md`](publication-freeze.md); the one-way authority record
is [`release/specification-authority.json`](../release/specification-authority.json).

The literal Host API `forms.takoform.com/v1` is a separate unpublished
candidate. Specification 1.1 did not publish it. There is no `/v1.1` Host lane,
and API v2 remains proposal-only: no v2 route, schema, tag, or receipt is minted
by this tree.

## Contract map

Takoform has five independent contract areas.

1. **Exact Form and Package data.**
   [`form-definition/`](form-definition/) defines the four-field exact FormRef
   and portable desired, observed, and output shapes.
   [`form-package/`](form-package/) defines a closed data-only package for one
   exact Form. [`core/`](core/) defines compilation of already verified,
   digest-pinned packages and contracts into one immutable Snapshot.
2. **Desired Resource lifecycle.**
   [`host-api/`](host-api/) defines discovery, support, validate/prepare/apply,
   read/import/observe/refresh/delete, asynchronous Operations, identity fences,
   and portable errors. A Host owns implementation, placement, credentials,
   state, and mutation.
3. **Family namespaces.**
   [`form-families.md`](form-families.md) defines versionless reverse-DNS group
   ownership and group-first exact lookup. Core has no built-in publisher or
   family list; any publisher may use a namespace it controls.
4. **Interface, Binding, artifact, and standard-service contracts.**
   [`interface-contract/`](interface-contract/),
   [`binding-contract/`](binding-contract/),
   [`artifact-transport/`](artifact-transport/), and
   [`standard-services/`](standard-services/) define digest-bound data
   contracts. They do not carry executable implementations or credentials.
5. **Trust, lifecycle, and release identity.**
   [`trust/`](trust/) defines caller-supplied publisher provenance and offline
   verification inputs. [`schemas/`](schemas/) carries active authoring schemas
   and byte-exact verify-only history. The append-only release ledgers bind
   published identities without advancing another version axis.

## Publisher equality

A FormRef contains only `apiVersion`, `kind`, `definitionVersion`, and
`schemaDigest`. It has no official bit. Official and independently maintained
publishers use the same package schema, canonical digest, signature and source
policy, revocation processing, installation record, Host support report, and
activation mechanism.

The difference is provenance: a publisher controls a namespace and source, and
an operator chooses which exact issuer/repository/workflow/ref policy to trust.
Core ships no ambient trusted publisher, privileged route, default allowlist,
or trust bypass.

Verification does not install a package. Installation does not imply Host
support. Support does not activate a Form. Activation does not add a typed
client projection or commercial Offering. Customer Resource traffic must not
download packages or executable code.

## Schemas and retained identities

[`release/public-schema-identities.json`](../release/public-schema-identities.json)
is the current schema identity ledger. Every active and verify-only entry keeps
an exact `$id`, repository path, and raw SHA-256. Verify-only schemas exist so
historical artifacts remain readable; they are not valid authoring or new
publication inputs.

The extracted W09 compatibility and mixed publication records are preserved
byte-exact under [`docs/extraction/history/`](../docs/extraction/history/README.md).
They explain predecessor history and are never regenerated or treated as
current Core authority.

## Public reference implementation

The repository's Go packages implement, but do not redefine, the contracts:

- [`formpackage`](../formpackage/) performs canonical package validation;
- [`snapshot`](../snapshot/) compiles a deterministic immutable graph and
  returns no partial Snapshot on failure;
- [`hostclient`](../hostclient/) implements the literal Host API v1 client; and
- [`trust`](../trust/) verifies caller-supplied trust material offline.

Generic conformance uses synthetic reverse-DNS families and must pass with zero
official families. Family semantics and concrete Host adapters belong to their
own publishers and Hosts.

## Verification boundary

`bun run check` is the complete portable repository gate. It validates source
ownership, extraction and immutable record pins, schema closure, formatting,
static analysis, tests, generic conformance, race-sensitive packages, and
standalone builds. It does not publish, sign, deploy, install, activate, or
mutate a Resource, and a green result is not live interoperability or operator
evidence.
