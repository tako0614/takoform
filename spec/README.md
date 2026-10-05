# Takoform API and common model

This non-normative index separates the v2 specification text from the
published, frozen v1 reference. It does not add to or reinterpret either contract.

## Host API v2 specification — not yet published

The [Host API v2 specification](host-api/v2/README.md) treats publisher-owned
HTTP specifications as Form identities and allows v2-only implementations.
Its normative source is being prepared for publication; this index does not
claim a public release or an implemented Host. Published v1
remains frozen reference material; retaining it does not require new v2 Hosts
or clients to implement v1.

Read the v2 [overview](host-api/v2/README.md), [HTTP API](host-api/v2/http.md),
[Form authoring rules](host-api/v2/forms.md), and [examples](host-api/v2/examples.md).
The [migration guide](host-api/v2/migration.md) explains the differences from v1.

## Published Host API v1 reference

The currently published Host API is the unchanged literal v1 lane. The rest
of this index maps v1 only; its package, Snapshot, and trust requirements do
not apply to v2:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire contract: [`host-api/v1.md`](host-api/v1.md); and
- generic corpus: [`../conformance/takoform-v1/generic.json`](../conformance/takoform-v1/generic.json).

API v1 normative bytes are frozen by
[`host-api/v1.freeze.json`](host-api/v1.freeze.json). Errata are non-normative
and cannot reinterpret v1. Behavioral changes belong to a different API major;
the v2 specification text is linked above and does not modify published v1.
There is no Host API minor lane such as `/v1.1`. Form compatibility is
versioned independently by each Form's `definitionVersion`, and that and the
literal v1 lane are the only two compatibility axes
([decision 0060](decisions/0060-two-version-axes-and-no-numbered-specification-stream.md)).

## v1 authority and contract map

The current Host API v1/common-model normative closure is exactly the prose,
machine roots, and recursive schema identities named by
[`host-api/v1.freeze.json`](host-api/v1.freeze.json). The broader append-only
[`release/public-schema-identities.json`](../release/public-schema-identities.json)
also retains identities outside that frozen closure; this map and the schema
index do not promote those identities into v1.
All publishers use the same package, verification, trust, revocation,
installation, and support paths; provenance is selected by the operator, and a
FormRef has no `official` bit.

- [`form-definition/`](form-definition/) defines the exact four-field FormRef
  and portable desired, observed, and output shapes.
- [`form-package/`](form-package/) defines one closed data-only package for one
  exact Form.
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
- [`versioning.md`](versioning.md) defines the four named version streams—Host
  API major, each Form's `definitionVersion`, Core library SemVer, and Provider
  SemVer—and their compatibility rules.

Requirement keywords and conformance classes are defined in
[`conformance.md`](conformance.md). Generic conformance uses synthetic
reverse-DNS families and must pass without a built-in family; concrete Host
adapters and family semantics belong to their publishers and Hosts.

Individual Form definitions, Form-specific examples, catalogs, and Form pages
are published by each Form publisher on that publisher's own site. This site
does not collect or republish them as a central registry.

Form publication, Host support, activation, and commercial offerings are
decisions made by their respective owners. No central Form status record is
part of the current contract.

Proposed contract changes under review live in
[`proposals/`](proposals/); they are not current contract. Core software
releases follow
[`release/core-release-policy.md`](../release/core-release-policy.md).
