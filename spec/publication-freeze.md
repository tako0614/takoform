# Current publication and change boundary

The current model has exactly four version streams: Host API major, each Form's
`definitionVersion`, Core/library SemVer, and Provider SemVer. The predecessor
W09 policy and publication evidence are imported under
[`docs/extraction/history/`](../docs/extraction/history/README.md); they are
history, not current writer authority.

## Historical Specification receipt

Specification 1.1 is immutable history published from
`github.com/tako0614/terraform-provider-takoform`. Its original source, tag,
Release, snapshot, and asset receipt remain exact in the append-only
[`release/specification-releases.json`](../release/specification-releases.json)
ledger and the extracted
[`Specification 1.1 evidence`](../docs/extraction/history/specification-1.1-publication-evidence.json).
This repository must not recreate, retag, overwrite, or relocate it.
Specification 1.0 was never published, is withdrawn, and cannot be reused.
There is no current Specification 1.0 or 1.1 release lane; the receipt is not a
fifth stream.

Editing `main` does not publish a version stream, Host API, Form, Form Package,
Interface, Binding, Provider, Host capability, activation, or Offering. The
literal `forms.takoform.com/v1` Host API remains an independent unpublished
candidate.

## Host API v1 stability

The current Host API v1 is the exact lane discovered at
`/.well-known/takoform/v1` and served at `/apis/forms.takoform.com/v1`. Its
wire prose and machine documents are [`host-api/v1.md`](host-api/v1.md) and
[`host-api/operations-v1.json`](host-api/operations-v1.json). Their required
bytes and semantics are frozen: a Core or Provider release, new Form, or
elapsed time does not reopen v1.

Editorial corrections MAY clarify prose only when every conforming peer's
accepted, sent, stored, and observed behavior is unchanged. A new endpoint,
field, error, feature, constraint, state transition, discovery member, or
changed lifecycle meaning is an API change and waits for a separately
justified Host API v2. There is no Host API v1.1 lane or calendar checkpoint.

## Dormant writer

[`release/specification-authority.json`](../release/specification-authority.json)
remains `prepared-writer-disabled`. The repository may contain the reviewed P0
writer, adapter, policies, tests, and owning deploy interface, but every
release phase, including release verification, must reject before constructing an adapter or touching a
signer, credential, writer, package/source script, or network callback. There
is no CI writer, ambient root/bypass authority, or public identity implied by
dormant code.

P0 is an immutable transitive execution closure. P records P0 in its direct
authority-only child; predecessor tombstone T pins P; the separate first
schema-origin cutover must complete; and only then may direct authority-only A
activate the successor. A dual-writer interval and authority reopening are
forbidden. A later P0 program change requires another explicit authority
rotation; D, N, E, recovery, and receipt commits cannot change it. The exact
rules are in
[`release/specification-release-policy.md`](../release/specification-release-policy.md).

## Independent publication boundaries

The four current streams have independent owners, evidence, and cadence. A
schema-only append/deploy has no Specification version, tag, Release, or receipt;
the schema identity is an exact wire artifact. A Form Package publisher may
publish package bytes under its own policy, while this repository only verifies
the closed data-only envelope and digest.

The dormant writer describes a possible future Specification identity only; it
does not make a current release lane. No command in this tree may recreate,
retag, overwrite, or relocate the occupied Specification 1.1 receipt. Design
text for a possible Host API v2 is allowed only below `spec/proposals/` with
exact `classification: non-normative-proposal` front matter. No v2 route,
schema, tag, receipt, or Release is current publication evidence.

Host API major, each Form `definitionVersion`, Core/library SemVer, and Provider
SemVer remain independent. Official and third-party publishers use the same
package, verification, trust, revocation, installation, support, and activation
mechanisms; provenance may differ, but the contract has no official privilege
bit or bypass.

`bun run check` is a read-only portable gate. It does not publish, sign,
install, activate, deploy, or mutate a Resource.
