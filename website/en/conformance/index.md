---
title: V1 conformance checks
---

# V1 conformance checks {#conformance-と参照実装}

This non-normative guide explains the retained v1 verification tools and reports. For v2 requirements,
read the [v2 HTTP API](/en/spec/host-api/v2/http#conformance).
The package, Snapshot, and signature checks below are not mandatory v2 requirements.

A report describes whether the named data or implementation satisfies the
requirements under test. A valid package, for example, does not establish that
its Form is usable on a particular Host.

The [v1 conformance specification](/en/spec/conformance) defines the retained requirements.

## What is being verified? {#claim-を分けて読む}

| Subject | Main checks |
| --- | --- |
| Form Package | Definition, FormRef, canonical contents, declared files and allowed data formats |
| Interface / Binding | Digests, definitions, operations and capabilities |
| Snapshot | Complete data and references, and order-independent construction |
| Host | API, resource lifecycle, concurrency, retries, identities and errors |
| Client | Only declared settings are sent; FormRef is kept distinct from package identity |
| Publisher trust data | Provenance, signatures, publication records and revocation data |

One result does not prove another subject's conformance or production readiness.

## Run local verification {#repository-から実行できる-harness}

First fetch dependencies at the repository root. This step may access the network.

```console
go mod download
```

After dependencies are available, the following checks do not access the network or modify resources.

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

This checks the package index, declared files, FormRef and digests.

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

This checks package, Interface, Binding and Snapshot references, input-order
independence and absence of partial results on failure. `external-family` and
`zero-family` are fixtures, not real Forms or running Hosts.

Neither command performs Host resource operations, activates a Form or starts executable code.

## Reading a report {#report-を読むときの確認点}

1. Check the subject of the report, not just `status`.
2. Identify the verified definition using all four FormRef fields.
3. Distinguish the package index's `packageDigest` from the definition's `schemaDigest`.
4. Check publication and Host operation outcomes separately in the publisher's or Host's records.

## Source code {#source}

Verification tools and fixtures are on [GitHub](https://github.com/tako0614/takoform).
For checks of the OpenTofu implementation, see
[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform).

## Read next {#次に読む}

- [Retained Host API v1](/en/spec/host-api/v1) — v1 discovery and operations.
- [Migration to v2](/en/spec/host-api/v2/migration) — differences when moving to the separate API.
- [Host API v1](/en/v1/) — the specification covered by these checks.
