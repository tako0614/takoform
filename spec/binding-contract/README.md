# Typed Binding contracts (`bindings.takoform.com/v1alpha2`)

This document defines exact Binding identity and transport relationships. A
Binding is a digest-bound, data-only contract that grants one consumer resource
a typed capability on one target resource. The runtime API and permission
arrive together; credentials do not cross the contract.

Project-maintained and independent publishers use the same authoring,
canonicalization, and admission mechanism. Publisher provenance is evaluated
by an operator-selected trust policy and is not encoded in a BindingRef. Core
does not maintain a preferred Binding catalog or a client-specific mapping.

## BindingRef

```json
{
  "apiVersion": "bindings.takoform.com/v1alpha2",
  "name": "example.storage",
  "version": "1.0.0",
  "schemaDigest": "sha256:..."
}
```

`name` uses the dotted grammar and `schemaDigest` binds the canonical Binding
Definition bytes. The normative shapes are
[`binding-ref-v1alpha2.schema.json`](../schemas/binding-ref-v1alpha2.schema.json)
and
[`binding-definition-v1alpha2.schema.json`](../schemas/binding-definition-v1alpha2.schema.json).

## Binding Definition

A Binding Definition fixes, as data only:

- `sourceRole`, the one Form role allowed to hold the binding;
- `targetInterface`, the exact InterfaceRef the target must provide;
- `allowedTargetForms[]`, the exact group and kind pairs this binding may
  reference;
- `runtimeProjection`, the operations exposed to the consumer and any
  restricted access modes;
- `description`, the concrete input, output, failure, and streaming behavior
  that callers observe; and
- `bindingNameGrammar`, the grammar for instance names in the consumer's
  desired state.

`lifecycle` records what happens to the binding when its target is deleted;
`dependency_in_use` is the default refusal. These fields describe a contract,
not an implementation or credential delivery mechanism.

Behavioral details that cannot be represented by the meta-schema belong in the
Definition's own descriptions and in declarative Interface fixtures. The
published schemas are structural minima, as explained by
[decision 0014](../decisions/0014-published-schemas-are-structural-minima.md).

## Binding instances

A consumer resource declares each instance as typed data: a name plus an exact
resource reference.

```json
{
  "name": "CACHE",
  "resource": {
    "apiVersion": "storage.publisher.example",
    "kind": "Storage",
    "name": "cache"
  }
}
```

The reference carries `apiVersion`, `kind`, and `name`. After resolution, a
Host records the target UID and exact FormRef in Host-owned state; desired
state retains the name reference. A delete/recreate under the same name is a
new incarnation and is not silently re-bound.

Sensitive values never appear in a Binding or its instance. A Binding projects
an API, not a credential. The consumer's runtime ABI decides where sealed
values are delivered, and integration-private entries remain outside the
portable contract. Cross-space targets are unrepresentable when the wire shape
has no space member.

## Which Binding a list carries

A Form Definition annotates each Binding list in its desired schema:

```json
"storageBindings": {
  "type": "array",
  "items": { "…": "one {name, resource} instance" },
  "x-takoform-binding": "example.storage"
}
```

The annotation names the contract. The Form's `acceptedBindings` entry carries
the exact digest-bound BindingRef, so one digest is authoritative. The target
reference may additionally carry `x-takoform-required-interface`, which MUST
equal the Binding Definition's `targetInterface`
([decision 0022](../decisions/0022-relations-pin-the-target-contract.md)).

## Host verification before mutation

A Host that implements a Binding verifies it before mutation:

1. the source Form accepts the annotated Binding;
2. the Host has the exact Binding Definition digest;
3. the source role equals `sourceRole`;
4. the resolved target group and kind are listed in `allowedTargetForms`;
5. the target Form provides the exact `targetInterface`; and
6. the reference's required-interface annotation agrees with that contract.

Missing capability is `unsupported_capability`; a contract or role mismatch is
`invalid_argument`. A Host MUST resolve a target by exact UID and FormRef and
MUST NOT infer a Binding from a name or a merely similar target.

Deleting a resource with a live Binding or other stored relation fails
`dependency_in_use` until the relation is removed. The detailed lifecycle and
fencing checks belong to a Host's own conformance evidence; the neutral Core
artifact corpus does not execute them.

## Artifact acquisition and digest scope

Core defines the BindingRef and Definition schemas and verifies caller-supplied
exact artifacts. It does not require a repository-wide Binding catalog or a
Binding Package envelope. A caller may acquire a Binding Definition from any
publisher, then pin its canonical digest in a Snapshot. A BindingRef's digest
binds only the Definition bytes: it carries no package digest, publisher
identity, signature, revocation feed, or credential.

An opaque external standard service is separate: a sealed
`standards.takoform.com/v1` slot carries an opaque protocol identifier and no
target Form or Binding Definition. It grants no portable lifecycle authority
over that service.
