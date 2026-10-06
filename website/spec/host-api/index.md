---
# Generated from spec/host-api/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/host-api/README.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/host-api/README.md
---

<div lang="en" class="specification-source">

# Takoform Host APIs

This page is non-normative navigation between the English v2 specification and
the retained, unchanged v1 contract. It does not add requirements to either API.

## Host API v2

Start with the [v2 model](/spec/host-api/v2/), then the [HTTP reference](/spec/host-api/v2/http)
and [Form requirements](/spec/host-api/v2/forms). The [examples](/spec/host-api/v2/examples) show
creation through deletion and recovery after failures. The
[migration guide](/spec/host-api/v2/migration) explains the separate v1 and v2 contracts.

The English source defines v2 and remains open to revision. See
[takoform.com](https://takoform.com/en/v2/) for the published version; local copies
and previews may differ. Publication does not certify any Host implementation.

## Retained Host API v1

Existing v1 implementations use the unchanged, provider-neutral Host API v1
contract ([`v1.md`](/spec/host-api/v1)). Its endpoints are:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire schema: [`host-api-wire-v1.schema.json`](https://forms.takoform.com/schemas/v1/host-api-wire.schema.json); and
- operation table: [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json).

The lane is a protocol identity, not a Form catalog or publisher allowlist. A
Host implements the contract and support profile independently. Its normative
bytes remain fixed by [`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json). Errata are
non-normative and cannot reinterpret v1. The separately defined v2 contract
does not modify these retained bytes or require dual-version implementations.

## V1 conformance material

The current generic artifact corpus is
[`conformance/takoform-v1/generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json).
It verifies package bytes, exact Interface and Binding contract bytes, and the
compiled immutable Snapshot. It does not execute Host lifecycle requests,
optimistic-concurrency fences, relation mutation, runtime code, activation,
Host Support, or a family-wide corpus. A Host or publisher supplies those
independent evidence sets through its own boundary.

Requirement keywords are used as described in
[`../conformance.md`](/spec/conformance).

Version and retained-lane rules are centralized in
[`../versioning.md`](/spec/versioning).


</div>
