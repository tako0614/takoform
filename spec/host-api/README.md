# Portable Form Host APIs

## Current unreleased Host API v1 draft

This is the current unreleased draft of the literal, provider-neutral Host API
v1 candidate ([`v1.md`](v1.md)), authored after the separate historical
Specification 1.1 snapshot:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire schema: [`host-api-wire-v1.schema.json`](../schemas/host-api-wire-v1.schema.json); and
- operation table: [`operations-v1.json`](operations-v1.json).

The lane is a protocol identity, not a Form catalog or publisher allowlist.
The immutable [Specification 1.1 predecessor release evidence](../../release/specification-releases.json)
records that its publication did not publish this Host lane. This draft does
not amend or attribute its rewritten text to that predecessor release.

## Retained predecessor lanes

The following documents are retained predecessor protocol snapshots. Their
identities, routes, and wire behavior remain readable only as the exact bytes
that were published at the time; they are not current lanes and are not
rewritten into v1:

- [`v1beta4.md`](v1beta4.md), the pre-v1 design snapshot;
- [`v1beta1.md`](v1beta1.md), the older retained Host API lane; and
- the withdrawn pre-Beta lanes recorded in the
  [extracted W09 document ledger](../../docs/extraction/history/published-document-lanes.json).

The predecessor repository's [immutable Host API source](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36/spec/host-api)
is the source for any historical route or identity not present in the current
tree. A retired identifier MUST NOT be reused for a different contract.

## Conformance boundary

The current generic artifact corpus is
[`conformance/takoform-v1/generic.json`](../../conformance/takoform-v1/generic.json).
It verifies package bytes, exact Interface and Binding contract bytes, and the
compiled immutable Snapshot. It does not execute Host lifecycle requests,
optimistic-concurrency fences, relation mutation, runtime code, activation,
Host Support, or a family-wide corpus. A Host or publisher supplies those
independent evidence sets through its own boundary.

Requirement keywords are used as described in
[`../conformance.md`](../conformance.md).
