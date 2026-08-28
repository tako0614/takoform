# Takoform portable specification

This is the family-neutral contract map for portable identities, data-only Form
Packages, immutable Snapshot compilation, Host lifecycle messages, trust
inputs, and conformance language.

## Current Host API and Core

The current Host API is the unchanged literal v1 lane:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire contract: [`host-api/v1.md`](host-api/v1.md); and
- generic corpus: [`../conformance/takoform-v1/generic.json`](../conformance/takoform-v1/generic.json).

The Core implementation in this source is distributed as the **v1.1.0** Go
software/module artifact. Core SemVer is not a Host API identity: no Host API
v1.1 exists, and the v1 discovery and API roots remain exact.

The checked-in `CounterReservation` package, exact FormRef, and runnable verify
output are introduced in the [repository example](../README.md#a-checked-in-form-example).

## Authority and contract map

The current normative contracts are the linked contract documents below and
the non-retired entries in
[`release/public-schema-identities.json`](../release/public-schema-identities.json).
`spec/proposals/` contains non-normative design; `spec/decisions/` contains
rationale and history; extracted and retained predecessor documents are
compatibility history.
All publishers use the same package, verification, trust, revocation,
installation, and support paths; provenance is selected by the operator, and a
FormRef has no `official` bit.

- [`form-definition/`](form-definition/) defines the exact four-field FormRef
  and portable desired, observed, and output shapes.
- [`form-package/`](form-package/) defines one closed data-only package for one
  exact Form.
- [`core/`](core/) defines deterministic compilation into one immutable
  Snapshot.
- [`host-api/`](host-api/) defines discovery, lifecycle requests,
  asynchronous Operations, identity fences, and portable errors.
- [`interface-contract/`](interface-contract/),
  [`binding-contract/`](binding-contract/),
  [`artifact-transport/`](artifact-transport/), and
  [`standard-services/`](standard-services/) define digest-bound data
  contracts.
- [`trust/`](trust/) defines caller-supplied provenance and offline
  verification inputs.
- [`form-families.md`](form-families.md) defines versionless reverse-DNS group
  ownership and group-first lookup.
- [`project-lifecycle.md`](project-lifecycle.md) defines Form maturity and the
  separate package-publication, publisher-trust, Host-support, activation,
  service-offering, and client-projection facts.
- [`versioning.md`](versioning.md) defines the two domain version axes and
  compatibility rules.
- [`publication-freeze.md`](publication-freeze.md) defines publication and
  change policy.

Requirement keywords and conformance classes are defined in
[`conformance.md`](conformance.md). Generic conformance uses synthetic
reverse-DNS families and must pass without a built-in family; concrete Host
adapters and family semantics belong to their publishers and Hosts.

## Public implementation

The Go packages implement, but do not redefine, the contracts:

- [`formpackage`](../formpackage/) validates canonical package data;
- [`snapshot`](../snapshot/) compiles digest-pinned contracts and returns no
  partial Snapshot on failure;
- [`hostclient`](../hostclient/) implements the literal Host API v1 client; and
- [`trust`](../trust/) verifies caller-supplied trust material offline.

The complete portable repository gate is:

```console
bun run check
```

It checks source ownership, immutable record pins, schema closure, formatting,
static analysis, portable tests, generic conformance, and standalone builds.
