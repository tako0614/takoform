---
title: Conformance checks
---

# Conformance checks {#conformance-と参照実装}

A report describes whether the named data or implementation satisfies the
requirements under test. A valid package, for example, does not establish that
its Form is usable on a particular Host.

This guide is non-normative. It explains how to read results; the
[conformance specification](/en/spec/conformance) defines the requirements.

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

Fetch dependencies using the [preparation steps](/en/start/#_0-準備), then run
these commands at the repository root. The checks do not access the network or
modify resources.

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

- [Getting started](/en/start/) — command output and API examples.
- [Host API overview](/en/host-api/) — discovery and main operations.
- [Reference](/en/reference/) — implementation specifications.
