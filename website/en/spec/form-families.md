---
# Generated from spec/form-families.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/form-families.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/form-families.md
---

<div lang="en" class="specification-source">

# Form families and namespaces

A Form Family is a publisher-defined group of Forms that share a namespace and
related semantics. A family is not a package, a release channel, or a
compatibility promise. The family model is described by
[decision 0009](https://github.com/tako0614/takoform/blob/main/spec/decisions/0009-form-families-and-namespaced-api-versions.md);
the portable-data rule for every member is
[`portability-boundary.md`](/en/spec/portability-boundary).

## Group identity

The `apiVersion` in a current FormRef is an opaque, versionless reverse-DNS
group controlled by the publisher, for example:

```text
forms.example.com
storage.publisher.example
```

The group is one identity component. `kind`, `definitionVersion`, and
`schemaDigest` complete the exact Form identity. A host and a client resolve
the four members together and MUST NOT choose a family, kind, or version by
`latest`, by a built-in list, or by a publisher preference.

There is no official-family roster or central kind enum. Every publisher uses
the same package, digest, and contract mechanisms. The only distinction is
publisher provenance and the trust policy an operator chooses for it. Takoform
does not reserve a namespace, grant an official shortcut, or infer trust from a
group name.

The reverse-DNS group is carried as one path segment by Host API v1. A group
containing `/` is invalid; a version belongs in the Form's
`definitionVersion`, not in a second family segment. See
[`host-api/v1.md`](/en/spec/host-api/v1) for the wire path rules.

## Exact references

An exact FormRef is:

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.1.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

Changing a Form's desired contract creates a new `definitionVersion` and
digest. Renaming a group re-identifies every member because the group is part
of the digest-bound definition. Package digest, publisher policy, Host
support, activation, and commercial availability are separate facts and never
change FormRef equality.

## Resource roles

Every current Form Definition declares one role from a closed vocabulary. Roles
describe how a host may reason about a resource; they do not select a backend
or grant lifecycle authority.

| Role | Meaning | Portable rule |
| --- | --- | --- |
| `identity` | long-lived logical resource | carries no implementation snapshot |
| `revision` | immutable implementation snapshot | changes create a new resource |
| `deployment` | selection of active revisions | the mutable traffic or rollout path |
| `attachment` | connection to an external event or endpoint | deleting it does not delete its parent |
| `policy` | independently changed operating rules | does not become parent identity |

Outward capability use is represented by a typed Binding held by the resource
whose contract declares it. Inward activation is represented by an attachment
that points at the activated resource. A Form publisher may define additional
relationships through the closed relation and Binding vocabulary, but a family
does not turn those relationships into a universal graph language.

## Host support

The publisher owns a Form Definition and its portable semantics. A host
chooses which exact Forms, Interfaces, and Bindings it has installed and which
operations it can support. A host MAY support a subset of a family and MUST
advertise or refuse that exact subset according to its own support policy; a
family name does not imply support.

The Snapshot compiler accepts zero or more publisher-supplied packages and exact
contract documents. This is intentional: compiling an empty family set proves
that the model has no hidden family roster. Generic artifact conformance uses
synthetic reverse-DNS groups and is independent of any publisher's catalog.

## Compatibility

Occupied versioned groups remain readable only under their exact historical
identities. They are not current family namespaces and MUST NOT be reused for
new semantics. [`versioning.md`](/en/spec/versioning) defines the shared retention
and non-reuse rules.

A family groups related Form contracts; it does not combine them into one
package or select a Host implementation, client schema, credentials, placement,
capacity, pricing, or a backend.


</div>
