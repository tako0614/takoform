---
# Generated from spec/host-api/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/host-api/README.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/host-api/README.md
---

<div lang="en" class="specification-source">

# Portable Form Host APIs

This page is non-normative navigation. The immutable contract is
[`v1.md`](/en/spec/host-api/v1), and its exact closure is named by
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json). Nothing on this page adds to or reinterprets
that contract.

## Current Host API v1

The current Host lane uses the unchanged literal, provider-neutral Host API v1
contract ([`v1.md`](/en/spec/host-api/v1)). Its endpoints are:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire schema: [`host-api-wire-v1.schema.json`](https://forms.takoform.com/schemas/v1/host-api-wire.schema.json); and
- operation table: [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json).

The lane is a protocol identity, not a Form catalog or publisher allowlist. A
Host implements the contract and support profile independently. Its normative
bytes never change. Errata are non-normative and cannot reinterpret v1; a
normative or behavioral change requires a future Host API v2 proposal.

## Conformance

The current generic artifact corpus is
[`conformance/takoform-v1/generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json).
It verifies package bytes, exact Interface and Binding contract bytes, and the
compiled immutable Snapshot. It does not execute Host lifecycle requests,
optimistic-concurrency fences, relation mutation, runtime code, activation,
Host Support, or a family-wide corpus. A Host or publisher supplies those
independent evidence sets through its own boundary.

Requirement keywords are used as described in
[`../conformance.md`](/en/spec/conformance).

Version and retained-lane rules are centralized in
[`../versioning.md`](/en/spec/versioning).


</div>
