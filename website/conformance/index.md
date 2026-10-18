---
title: V1 conformance checks
---

# <span id="conformance-と参照実装"></span>V1 conformance checks {#conformance-checks}

This non-normative guide explains the retained v1 verification tools and reports. For v2 requirements,
read the [v2 HTTP API](/spec/host-api/v2/http#conformance).
The package, Snapshot, and signature checks below are not mandatory v2 requirements.

A report describes whether the named data or implementation satisfies the
requirements under test. A valid package, for example, does not establish that
its Form is usable on a particular Host.

The [v1 conformance specification](/spec/conformance) defines the retained requirements. The [Takoform repository](https://github.com/tako0614/takoform) also provides a [v2 HTTP probe](/host-api/#check) that you run against your own Host with a disposable Resource of a Form it supports for create, read, update and delete.

## <span id="claim-を分けて読む"></span>What each result covers {#result-coverage}

| Evidence source | What it checks | What it does not establish |
| --- | --- | --- |
| `form-package verify` | One v1 Form Package's index, declared files, FormRef and digests | Host support, publication, or lifecycle behavior |
| `generic-conformance verify` | Caller-supplied package, Interface, Binding and Snapshot artifacts; reference closure, order-independent compilation, and failure behavior | Host lifecycle requests, fencing, support, activation, runtime code, or publisher family semantics |
| v2 HTTP baseline probe | A disposable Resource of a caller-selected Form, through an injected transport, for the probe's implemented checks | Complete Host or Form conformance, production operation, or a reusable SDK |
| Host, client, or publisher report | Only the exact implementation or workflow named in its evidence | Claims about a different Host, client, Form, publisher, or release |

Conformance claims belong to their stated subjects. One result does not transfer to another subject or establish production readiness.

## <span id="repository-から実行できる-harness"></span>Run local verification {#run-local-verification}

First fetch dependencies at the root of a Takoform repository clone. This step may access the network.

```console
go mod download
```

After dependencies are available, the following checks do not access the network or modify resources.

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

This checks one local v1 package's index, declared files, FormRef and digests.

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

This checks local package, Interface, Binding and Snapshot artifacts, reference
closure, input-order independence and no usable partial Snapshot on failure.
`external-family` and `zero-family` are fixtures, not real Forms or running
Hosts. The generic corpus is an artifact compiler check; it does not execute
Host operations or verify Host or client implementations.

Neither command performs Host resource operations, activates a Form or starts executable code.

## <span id="report-を読むときの確認点"></span>Reading a report {#reading-a-report}

1. Check the subject of the report, not just `status`.
2. Identify the verified definition using all four FormRef fields.
3. Distinguish the package index's `packageDigest` from the definition's `schemaDigest`.
4. Check publication and Host operation outcomes separately in the publisher's or Host's records.

## Source code {#source}

Verification tools and fixtures are on [GitHub](https://github.com/tako0614/takoform).
For checks of the OpenTofu implementation, see
[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform).

## <span id="次に読む"></span>Read next {#read-next}

- [Retained Host API v1](/spec/host-api/v1) — v1 discovery and operations.
- [Migration to v2](/spec/host-api/v2/migration) — differences when moving to the separate API.
- [Host API v1](/v1/) — the specification covered by these checks.
