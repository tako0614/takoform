# Portable Form Host APIs

## Current Host API v1

The current Host lane uses the unchanged literal, provider-neutral Host API v1
contract ([`v1.md`](v1.md)). Its endpoints are:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire schema: [`host-api-wire-v1.schema.json`](../schemas/host-api-wire-v1.schema.json); and
- operation table: [`operations-v1.json`](operations-v1.json).

The lane is a protocol identity, not a Form catalog or publisher allowlist.
Core v1.1.0 is a software/module artifact that changes no v1 wire identity; a
Host still implements the contract and support profile independently. There is
no Host API v1.1.

## Conformance

The current generic artifact corpus is
[`conformance/takoform-v1/generic.json`](../../conformance/takoform-v1/generic.json).
It verifies package bytes, exact Interface and Binding contract bytes, and the
compiled immutable Snapshot. It does not execute Host lifecycle requests,
optimistic-concurrency fences, relation mutation, runtime code, activation,
Host Support, or a family-wide corpus. A Host or publisher supplies those
independent evidence sets through its own boundary.

Requirement keywords are used as described in
[`../conformance.md`](../conformance.md).

Version and retained-lane rules are centralized in
[`../versioning.md`](../versioning.md).
