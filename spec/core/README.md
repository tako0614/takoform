# Takoform neutral Core and compiled Snapshot

Core is the family-neutral compiler boundary for Takoform API 1.0.1. It turns
already acquired, data-only contract artifacts into one closed, immutable graph
that a client, Host adapter, or artifact conformance tool can consume.

## Core model

The portable meaning shared by Core consumers includes:

- RFC 8785 and I-JSON canonicalization;
- complete Form Package closure and exact identity checks;
- Definition and schema validation;
- exact Form, Interface, and Binding reference closure;
- Host API lower-bound compatibility;
- recursive default materialization;
- explicit create-default selection;
- deterministic ordering and diagnostics; and
- Snapshot identity.

Core handles contract data only. Form rosters, publisher admission and trust
selection, client projections, Host implementations and Resource state,
credentials, targets, activation, availability, price, and capacity remain
outside this boundary.

## Acquisition and admission

An acquisition adapter first obtains an immutable package closure. The Core
package verifier proves that its index names every payload, byte sizes and
digests match, the closure is data-only, and fixtures satisfy the Definition.
The caller then applies its selected publisher identity, signature,
transparency, and revocation policy. Core receives only the result of those
checks, never a secret or an executable payload.

The verifier issues an immutable package capability only after the complete
check succeeds. Core receives:

- diagnostics-only origin information;
- the expected canonical package-index digest;
- a verifier-issued capability containing the validated index, canonical
  Definition, complete inventory, and verified payload copies;
- zero or more digest-pinned Interface Definitions; and
- zero or more digest-pinned Binding Definitions.

Origin and publisher identity never participate in exact contract equality.
Directory, embedded, OCI, and HTTP-by-digest acquisition are adapters, not
alternate compiler semantics.

## Input model

One input contains:

1. the exact Host API lane selected by the caller;
2. zero or more verified package capabilities with explicit package-digest
   pins;
3. zero or more exact Interface Definition artifacts;
4. zero or more exact Binding Definition artifacts; and
5. zero or one explicit create-default pin for every selected `(group, kind)`.

Input order has no meaning. A family group is a reverse-DNS identity; lookups
are always group-first. Core has no Kind-only, newest, or built-in publisher
fallback. Zero packages and zero default pins are valid and are required to
prove that Core has no hidden family roster.

## Compilation and diagnostics

Compilation validates the selected Host API lane, verifies each package
capability and digest pin, validates exact Interface and Binding definitions,
rejects duplicate identities, indexes all contracts, checks the Host API lower
bound, closes every exact reference, checks Binding projections, requires one
explicit default per selected group and kind, and freezes stable views ordered
by exact identity. Any failure returns diagnostics and no partial Snapshot.

The stable diagnostic codes are `invalid_input`, `invalid_artifact`,
`digest_mismatch`, `duplicate_identity`, `unresolved_reference`,
`ambiguous_default`, `missing_default`, and `unsupported_host_api`.
Diagnostics sort by subject, JSON Pointer, code, then message. Reordering input
MUST produce byte-identical Snapshot identity and diagnostics.

## Snapshot contents and operations

A successful Snapshot owns copies of all input bytes and exposes only copied
views. It contains exact FormRefs and package digests, canonical Definitions,
exact Interface and Binding references and bytes, the closed reference graph,
explicit defaults, and the selected Host API lane. Its digest covers a
canonical normalized projection of those facts; diagnostics-only origin and
publisher identity are excluded.

The public operations enumerate Forms, Interfaces, and Bindings; retrieve a
canonical Definition by exact FormRef; resolve a create default by exact
group/kind; and validate and default materialize desired I-JSON for an exact
FormRef. A wrong group, version, or digest is a miss. No operation falls back
to another identity.

## Snapshot consumers

A client adapter consumes a Snapshot and may build its own typed projection,
state, imports, codecs, or migration policy. Those are client-owned facts and
are not Core schemas or authority. A Host consumes a Snapshot only after its
own package admission and separately decides implementation support, tenant
policy, activation, and Resource lifecycle. A conformance tool consumes a
Snapshot together with explicitly selected corpora; family-specific semantics
remain outside neutral Core.

Project-maintained and independent publishers use the same compile path. A
publisher policy may distinguish provenance, but Core has no official publisher
enum, trust bypass, or namespace shortcut.

## Conformance

The neutral artifact corpus is
[`../../conformance/takoform-v1/generic.json`](../../conformance/takoform-v1/generic.json).
It verifies package bytes, exact Interface/Binding contract bytes, and the
immutable compiled Snapshot. It is deliberately not a lifecycle runner: it
does not execute create/read/update/delete, fencing, relation mutation,
runtime code, Host Support, activation, or every publisher's family semantics.

Core-level witnesses include:

- zero-family compilation;
- two synthetic external groups using one Kind without collision;
- cross-group exact-reference closure and wrong-digest rejection;
- input-permutation equality for Snapshot and diagnostics;
- no partial Snapshot on failure;
- complete-package forgery resistance and defensive-copy ownership;
- unknown and insufficient Host API refusal; and
- exact Interface/Binding closure and immutable Definition views.

Version and retained-history rules are centralized in
[`../versioning.md`](../versioning.md).
