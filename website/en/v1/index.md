---
title: Host API v1
description: Entry point to the frozen Host API v1 contract, common model, schemas and verification documentation.
---

# Host API v1 {#v1}

Documentation for reading and using existing v1 implementations. The frozen specification text and published schemas are preserved. Requirements from v2 do not add requirements to this version.

## Implement the API {#api}

- [HTTP API specification](/en/spec/host-api/v1) — Endpoints, requests, responses and operation rules.
- [Versioning and compatibility](/en/spec/versioning) — Version handling and compatibility boundaries.

## Read the common model {#model}

- [Form Definition](/en/spec/form-definition/) — Resource definitions.
- [Form Package](/en/spec/form-package/) and [Snapshot](/en/spec/core/) — Distribution and resolution.
- [Interface](/en/spec/interface-contract/) and [Binding](/en/spec/binding-contract/) — Connection contracts.
- [Trust and revocation](/en/spec/trust/) — Verification rules for v1.

## Verification and existing tools {#tools}

- [Schema index](/en/schemas/) — Published JSON schemas.
- [Conformance](/en/spec/conformance) and [verification tools](/en/conformance/) — What checks cover and where they stop.
- [Provider usage guide](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start) — Use this Provider from OpenTofu or Terraform. The Provider is an implementation, separate from the API specification.

## Looking for v2? {#v2}

[v2 documentation](/en/v2/) describes a separate API version. Read [Migration from v1](/en/spec/host-api/v2/migration) for the differences. Changing documentation versions does not migrate a running Host or existing resources.
