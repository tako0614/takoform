---
# Generated from spec/README.md by scripts/site.mjs. Edit the specification, not this page.
canonicalSource: spec/README.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/README.md
---

# Takoform API and common model

This is the family-neutral contract map for portable identities, data-only Form
Packages, immutable Snapshot compilation, Host lifecycle messages, trust
inputs, and conformance language.

## Current Host API

The current Host API is the unchanged literal v1 lane:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire contract: [`host-api/v1.md`](/spec/host-api/v1); and
- generic corpus: [`../conformance/takoform-v1/generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json).

API v1 behavior is frozen. Editorial clarifications may keep the exact v1 lane
only when they change no accepted request, response, error, lifecycle semantic,
or peer obligation; every behavioral change uses a new API major. Form
compatibility is versioned independently by each Form's `definitionVersion`.

## Authority and contract map

The current normative contracts are the linked contract documents below and
the non-retired entries in
[`release/public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json).
All publishers use the same package, verification, trust, revocation,
installation, and support paths; provenance is selected by the operator, and a
FormRef has no `official` bit.

- [`form-definition/`](/spec/form-definition/) defines the exact four-field FormRef
  and portable desired, observed, and output shapes.
- [`form-package/`](/spec/form-package/) defines one closed data-only package for one
  exact Form.
- [`host-api/`](/spec/host-api/) defines discovery, lifecycle requests,
  asynchronous Operations, identity fences, and portable errors.
- [`interface-contract/`](/spec/interface-contract/),
  [`binding-contract/`](/spec/binding-contract/),
  [`artifact-transport/`](/spec/artifact-transport/), and
  [`standard-services/`](/spec/standard-services/) define digest-bound data
  contracts.
- [`trust/`](/spec/trust/) defines caller-supplied provenance and offline
  verification inputs.
- [`form-families.md`](/spec/form-families) defines versionless reverse-DNS group
  ownership and group-first lookup.
- [`project-lifecycle.md`](/spec/project-lifecycle) defines Form maturity and the
  separate package-publication, publisher-trust, Host-support, activation,
  service-offering, and client-projection facts.
- [`versioning.md`](/spec/versioning) defines the two domain version axes and
  compatibility rules.

Requirement keywords and conformance classes are defined in
[`conformance.md`](/spec/conformance). Generic conformance uses synthetic
reverse-DNS families and must pass without a built-in family; concrete Host
adapters and family semantics belong to their publishers and Hosts.

Individual Form definitions, Form-specific examples, catalogs, and Form pages
are published by each Form publisher on that publisher's own site. This site
does not collect or republish them as a central registry.
