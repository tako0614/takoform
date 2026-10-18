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
| `takoform-trust verify-bundle` | One subject's Sigstore bundle against the trusted root and publisher policy you supply, including transparency-log inclusion | That you chose the right trusted root or publisher, or that the subject is safe to install |
| `takoform-trust check-not-revoked` | That a package digest and FormRef are not revoked by a verified revocation checkpoint that extends your previous pin or starts the chain | Installation, support or activation, or that no newer checkpoint revokes them |
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

## Verify signatures and revocation {#verify-trust}

`takoform-trust` runs the [trust contract](/spec/trust/) offline on files you
supply. It has no built-in trusted root, default publisher, or bypass: you
choose every input and keep the results. Install it with
`go install github.com/tako0614/takoform/cmd/takoform-trust@latest` (then
`takoform-trust version` prints the release to record with your results), or
run it from a clone with `go run ./cmd/takoform-trust`.

| Command | Inputs | Prints on success |
| --- | --- | --- |
| `verify-bundle` | `--subject`, the exact signed file; `--bundle`, its Sigstore v0.3 keyless message-signature bundle; `--trusted-root`, the Sigstore trusted root you select; `--policy`, the exact publisher-policy file | A bundle verification report with `status`, the subject, bundle and trusted-root digests, the issuer, repository, workflow and ref that signed it, and the source, workflow and build-config commits from its certificate |
| `verify-checkpoint` | `--checkpoint`, the publisher's canonical revocation checkpoint, with its `--bundle`, `--trusted-root` and `--policy`; `--previous-pin`, the pin from the checkpoint before it (omit only for the first checkpoint of a chain) | A checkpoint verification report, including the `pin` to keep for the next one |
| `check-not-revoked` | The `verify-checkpoint` inputs, plus `--package-digest` and `--form-ref`, a FormRef file | `{"status": "not-revoked", ...}` with the digest, the FormRef and the checkpoint report |

```console
takoform-trust check-not-revoked \
  --checkpoint checkpoint.json --bundle checkpoint.sigstore.json \
  --trusted-root trusted-root.json --policy publisher-policy.json \
  --previous-pin previous-pin.json \
  --package-digest sha256:<package digest> --form-ref form-ref.json
```

Each command prints JSON to standard output and exits 0 only when the whole
verification passes. On failure it prints
`{"status": "error", "code": ..., "message": ...}` to standard error and exits
1, or 2 for a usage error. The codes are `usage`, `input-error`,
`invalid-policy`, `malformed-bundle`, `malformed-trusted-root`,
`missing-transparency`, `invalid-checkpoint`, `verification-failed` and
`revoked`.

Without `--previous-pin`, only the first checkpoint of a publisher's chain
verifies; for the current format that is the signed sequence-0 genesis, which
revokes nothing. After a checkpoint verifies, save the `pin` object from its
report (`checkpoint.pin` in `check-not-revoked` output) as the
`--previous-pin` file for the next checkpoint, and keep it with the publisher
policy that verified it. Each checkpoint must be the next sequence after your
pin and extend it, so verify a publisher's checkpoints in order; rollback,
omission and forks fail. To check another package against the same
checkpoint, pass the same previous pin again. A pin is not authority for
another publisher. A passing result is an input to your own decisions: it does
not install, support or activate a Form.

## Source code {#source}

Verification tools and fixtures are on [GitHub](https://github.com/tako0614/takoform).
For checks of the OpenTofu implementation, see
[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform).

## <span id="次に読む"></span>Read next {#read-next}

- [Retained Host API v1](/spec/host-api/v1) — v1 discovery and operations.
- [Migration to v2](/spec/host-api/v2/migration) — differences when moving to the separate API.
- [Host API v1](/v1/) — the specification covered by these checks.
