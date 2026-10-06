---
# Generated from spec/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/README.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/README.md
---

<div lang="en" class="specification-source">

# Takoform API and common model

This non-normative index separates the v2 specification source from the
published, frozen v1 reference. It does not add to or reinterpret either contract.

## Host API v2 specification

The [Host API v2 specification](/en/spec/host-api/v2/) treats publisher-owned
HTTP specifications as Form identities and allows v2-only implementations.
The normative source is English and remains open to revision. The published
version is at [takoform.com](https://takoform.com/en/v2/); local copies and previews
may differ. This is not a separate document-version stream or immutable final text. Publication and
deployed Host support are separate facts. Published v1 remains frozen reference
material; retaining it does not require new v2 Hosts or clients to implement v1.

Read the v2 [overview](/en/spec/host-api/v2/), [HTTP API](/en/spec/host-api/v2/http),
[Form authoring rules](/en/spec/host-api/v2/forms), and [examples](/en/spec/host-api/v2/examples).
The [migration guide](/en/spec/host-api/v2/migration) explains the differences from v1.

Examples and guides remain informative, separate from normative requirements.

## Published Host API v1 reference

The retained Host API v1 is the unchanged literal v1 lane. The rest
of this index maps v1 only; its package, Snapshot, and trust requirements do
not apply to v2:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire contract: [`host-api/v1.md`](/en/spec/host-api/v1); and
- generic corpus: [`../conformance/takoform-v1/generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json).

API v1 normative bytes are frozen by
[`host-api/v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json). Errata are non-normative
and cannot reinterpret v1. Behavioral changes belong to a different API major;
the v2 specification text is linked above and does not modify published v1.
There is no Host API minor lane such as `/v1.1`. Form compatibility is
versioned independently by each Form's `definitionVersion`, and that and the
literal v1 lane are the only two compatibility axes
([decision 0060](https://github.com/tako0614/takoform/blob/main/spec/decisions/0060-two-version-axes-and-no-numbered-specification-stream.md)).

## v1 authority and contract map

The current Host API v1/common-model normative closure is exactly the prose,
machine roots, and recursive schema identities named by
[`host-api/v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json). The broader append-only
[`release/public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json)
also retains identities outside that frozen closure; this map and the schema
index do not promote those identities into v1.
All publishers use the same package, verification, trust, revocation,
installation, and support paths; provenance is selected by the operator, and a
FormRef has no `official` bit.

- [`form-definition/`](/en/spec/form-definition/) defines the exact four-field FormRef
  and portable desired, observed, and output shapes.
- [`form-package/`](/en/spec/form-package/) defines one closed data-only package for one
  exact Form.
- [`host-api/`](/en/spec/host-api/) defines discovery, lifecycle requests,
  asynchronous Operations, identity fences, and portable errors.
- [`interface-contract/`](/en/spec/interface-contract/),
  [`binding-contract/`](/en/spec/binding-contract/),
  [`artifact-transport/`](/en/spec/artifact-transport/), and
  [`standard-services/`](/en/spec/standard-services/) define digest-bound data
  contracts.
- [`trust/`](/en/spec/trust/) defines caller-supplied provenance and offline
  verification inputs.
- [`form-families.md`](/en/spec/form-families) defines versionless reverse-DNS group
  ownership and group-first lookup.
- [`versioning.md`](/en/spec/versioning) defines the four named version streams—Host
  API major, each Form's `definitionVersion`, Core library SemVer, and Provider
  SemVer—and their compatibility rules.

Requirement keywords and conformance classes are defined in
[`conformance.md`](/en/spec/conformance). Generic conformance uses synthetic
reverse-DNS families and must pass without a built-in family; concrete Host
adapters and family semantics belong to their publishers and Hosts.

Individual Form definitions, Form-specific examples, catalogs, and Form pages
are published by each Form publisher on that publisher's own site. This site
does not collect or republish them as a central registry.

Form publication, Host support, activation, and commercial offerings are
decisions made by their respective owners. No central Form status record is
part of the current contract.

Proposed contract changes under review live in
[`proposals/`](https://github.com/tako0614/takoform/tree/main/spec/proposals); they are not current contract. Core software
releases follow
[`release/core-release-policy.md`](https://github.com/tako0614/takoform/blob/main/release/core-release-policy.md).


</div>
