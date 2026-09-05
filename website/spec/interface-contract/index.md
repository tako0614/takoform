---
# Generated from spec/interface-contract/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/interface-contract/README.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/interface-contract/README.md
---

# Exact Interface contracts (`interfaces.takoform.com/v1alpha1`)

An Interface is a digest-bound, data-only contract for one portable operation
surface. Its exact reference identifies a Definition containing the operations
and behavior that implementations support. The rationale for this shape is
recorded in
[decision 0010](https://github.com/tako0614/takoform/blob/main/spec/decisions/0010-exact-interface-and-binding-contracts.md).

## InterfaceRef

```json
{
  "apiVersion": "interfaces.takoform.com/v1alpha1",
  "name": "storage.read",
  "version": "1.0.0",
  "schemaDigest": "sha256:..."
}
```

- `name` uses the dotted grammar
  `^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$` (maximum 128 characters);
- `version` is SemVer; and
- `schemaDigest` is the RFC 8785 canonical digest of the Interface Definition
  bytes.

The normative reference shape is
[`interface-ref-v1alpha1.schema.json`](https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-ref.schema.json).

## Interface Definition

The normative Definition shape is
[`interface-definition-v1alpha1.schema.json`](https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-definition.schema.json).
A Definition fixes, as data only:

- `operations[]`: operation name, input schema, output schema, and a closed
  `errors[]` vocabulary per operation; and
- `semantics`: the consistency, ordering, and pagination model for the whole
  surface.

It MAY declare `limits` for portable minimum limits and `fixtures[]` for
declarative behavior traces. It MUST NOT contain executable code, credentials,
endpoints, prices, or Host identities. The Form Package data-only policy
applies unchanged.

Behavior that cannot be represented structurally—streaming, exception
handling, cancellation, or an isolate lifetime—belongs in the Definition's
descriptions and in fixtures wherever a fixture can observe it. The published
meta-schema is a structural minimum, as explained by
[decision 0014](https://github.com/tako0614/takoform/blob/main/spec/decisions/0014-published-schemas-are-structural-minima.md).

## Runtime interfaces

A runtime supplied by a Host MAY be described as an Interface. A Form then
declares the exact InterfaceRef it requires in `providedInterfaces` or
`acceptedBindings`; a date, flag, or unregistered version token is not a
portable runtime contract. The runtime implementation and its invocation
environment belong to the Host or publisher that makes the claim, not to the
portable contract.

The artifact corpus in
[`../conformance.md`](/spec/conformance) verifies Interface Definition bytes,
digest pins, and Snapshot closure. It does not execute runtime code or claim
that any Host runs an Interface correctly. Runtime behavior requires separate
evidence from the owner of that runtime.

## Behavior fixtures

Shape validation alone cannot distinguish operation semantics, so an Interface
Definition SHOULD carry data-only traces:

```json
{
  "name": "write-then-read",
  "steps": [
    { "operation": "write", "input": { "key": "a", "value": "x" } },
    { "operation": "read", "input": { "key": "a" }, "expected": { "value": "x" } }
  ]
}
```

A runtime or Host that claims the Interface executes each trace in order
against one fresh scope and matches every `expected` clause. Properties not
deterministically observable from one client (for example, cross-location
eventual convergence) are outside package fixture scope.

A fixture MUST NOT contradict the `semantics` declared by its Definition. An
unpassable trace or an `expectedError` outside the operation's closed error
vocabulary is invalid. Every operation whose behavior is claimed MUST have
observable evidence; an unmeasured operation does not discharge that claim.

Values that are bytes use one encoded-bytes object so declared limits and
structural lengths measure the same quantity. Streaming operations state what
is known about length, absence, backpressure, cancellation, and truncation;
the bytes travel beside the document rather than inside it. A Definition's
descriptions are authoritative for the details the meta-schema cannot express.

## Artifact distribution

Takoform defines the Interface schemas; implementations verify exact artifacts
supplied by a caller. All publishers use the same contract
path. An Interface Definition is not an executable package and does not grant
Host support. A `schemaDigest` binds only canonical Definition bytes; it does
not encode package digest, publisher identity, signature, revocation feed, or
installation location. A publisher or operator may distribute the document
through any transport that preserves those bytes.

## Relationship to Forms and Bindings

- A Form Definition lists Interfaces its resources provide as exact
  `providedInterfaces[]` references.
- A Binding names the Interface its target must provide as an exact reference.
- A Host or client that claims support advertises limits and implementation
  evidence separately from the Interface Definition.
