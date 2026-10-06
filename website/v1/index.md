---
title: Host API v1
description: Entry point to the Host API v1 specification, common model, schemas and verification documentation.
---

# Host API v1 {#v1}

API specifications, the common model and verification resources for existing v1 Hosts and clients.

## API specification {#api}

- [HTTP API specification](/spec/host-api/v1) — Endpoints, requests, responses and operation rules.
- [Versioning and compatibility](/spec/versioning) — Version handling and compatibility boundaries.

## Resource and connection model {#model}

- [Form Definition](/spec/form-definition/) — Resource definitions.
- [Form Package](/spec/form-package/) and [Snapshot](/spec/core/) — Distribution and resolution.
- [Interface](/spec/interface-contract/) and [Binding](/spec/binding-contract/) — Connection contracts.
- [Trust and revocation](/spec/trust/) — Verification rules for v1.

## Verification and tools {#tools}

- [Schema index](/schemas/) — Published JSON schemas.
- [Conformance](/spec/conformance) and [verification tools](/conformance/) — What checks cover and where they stop.
- [OpenTofu / Terraform Provider guide](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start) — Connect to a v1 Host using the Provider.
