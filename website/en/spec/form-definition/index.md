---
# Generated from spec/form-definition/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/form-definition/README.md
canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/form-definition/README.md
---

<div lang="en" class="specification-source">

# Form Definition profiles

A Form Definition is a deterministic, data-only description of one portable
service shape. Requirement keywords are used as described in
[`../conformance.md`](/en/spec/conformance).

The current authoring profiles are
[`form-definition-v1.schema.json`](https://forms.takoform.com/schemas/v1/form-definition.schema.json)
and [`form-ref-v1.schema.json`](https://forms.takoform.com/schemas/v1/form-ref.schema.json). They use a
versionless reverse-DNS Form Family group and an exact four-field FormRef. The
profile moves independently from the Host API lane and from package or client
release identities.

Across the current profile, a Definition declares a closed role, exact
Interface and Binding references, and portable desired/observed/output schemas.
A desired schema does not contain a resource `name`: the Host wire envelope owns
`metadata.name`
([decision 0011](https://github.com/tako0614/takoform/blob/main/spec/decisions/0011-resource-identity-generation-and-revision.md)).
Free semantic tokens are prohibited by
[decision 0008](https://github.com/tako0614/takoform/blob/main/spec/decisions/0008-forms-preserve-service-shape.md).

## Exact FormRef

The immutable reference to a Definition is exactly these four fields, with no
extensions:

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.1.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

`kind` MUST be a PascalCase portable kind, `definitionVersion` MUST be SemVer,
and `schemaDigest` MUST be SHA-256 over the Definition's RFC 8785 canonical
bytes. The Definition MUST repeat the first three identity fields and a
verifier MUST reject a mismatch. Resolution never substitutes a family latest,
a sibling kind, or a Definition with a different version or digest.

## Definition fields

A Definition contains:

- its three non-digest identity fields;
- a title and optional description;
- inline Draft 2020-12 desired and observed schemas, plus an optional output
  schema;
- optional immutable JSON Pointer fields;
- an explicit subset of `create`, `read`, `update`, `delete`, `import`, and
  `observe`; and
- optional references to data-only positive desired/observed/output fixtures and
  negative schema fixtures in the same package.

The current profile admits an explicit subset of the listed operations; it does
not admit `refresh`, `drift`, or open connection descriptors. A Definition's
`requiresHostApi` lower bound is checked against the selected Host API lane and
the mechanisms the Definition actually declares, never against a kind or family
name.

The current family structure has no publication or lifecycle state field. A
Definition's `lifecycleCapabilities` declares the resource operations it
supports; a Host reports runtime lifecycle state. Neither publication labels
nor Host state are encoded in immutable Definition bytes.

Fixture stages are package data, not Host Support claims. A package verifier
checks their structure and stage vocabulary; lifecycle or runtime execution
evidence is supplied separately by the party making that implementation claim.

The published JSON Schema is a normative structural minimum. Document-local
reference closure, closed-object proof, validation-work limits, fixture
semantics, and the portable data-only vocabulary are also normative.

## Closed recursive values and defaults

The v1 authoring model adds concrete, bounded data shapes; it does not add a
generic JSON, bytes, message, or graph-expression type.

- An ordered string list preserves order and duplicate values; it is not a set.
- A string map and string-set map declare `maxProperties`, use the portable
  map-key grammar, and bound values. Set values also declare `maxItems` and
  `uniqueItems: true`.
- RFC 8785 supplies deterministic object-key order. Defaults and examples sort
  each string-set-map value lexically; ordered lists are never sorted or
  deduplicated.
- Closed objects and object lists recurse through the same vocabulary. Defaults
  materialize inside a present object or list element; an absent optional
  object remains absent.
- A tagged object is a closed `oneOf` whose branches share a required string
  discriminator and forbid unknown members.

## Structural and resolved-UID constraints

The closed `constraints` vocabulary includes desired-structure variants and
resolved-UID variants. Structural variants compare validated desired values
without coercion:

```json
{"kind":"orderedPair","references":["/minInstances","/maxInstances"]}
{"kind":"uniqueBy","list":"/secondaryIndexes","member":"name"}
```

`orderedPair` requires two distinct non-wildcard pointers to numeric
properties, with the first value less than or equal to the second. `uniqueBy`
requires a list of objects whose named scalar member is unique under typed JSON
equality.

Resolved-UID variants compare immutable Host-resolved UIDs only:

```json
{"kind":"acyclic","reference":"/deadLetter/queue"}
{"kind":"distinctPair","references":["/target","/deadLetter"]}
{"kind":"uniquePair","references":["/topic","/target"]}
{"kind":"sameResolvedTarget","anchor":"/function","members":"/versions/*/functionVersion","through":"/function"}
```

`acyclic` rejects a cycle; `distinctPair` requires different UIDs;
`uniquePair` allows one holder per exact Form and tenant; and
`sameResolvedTarget` requires every selected member target to resolve through
`through` to the anchor UID. A Definition with another constraint kind, wrong
pointer cardinality, or an undeclared local relation is invalid. There is no
universal graph DSL.

## Relations and artifact references

Current relations use exact digest-bound Interface and Binding contracts and
UID-pinned resource references
([`binding-contract/`](/en/spec/binding-contract/),
[decision 0015](https://github.com/tako0614/takoform/blob/main/spec/decisions/0015-cross-resource-references-are-uid-pinned-relations.md)).

An artifact-backed Definition carries one content-addressed manifest digest,
not a URL. A Host resolves and validates that digest before mutation; transport
and storage remain outside Definition identity.

## Closed recursive schemas

Object schemas are closed by default and MUST set
`"additionalProperties": false`. A pure typed map is the only open-key escape;
it explicitly uses `type: object`, an `additionalProperties` schema, and this
key policy:

```json
{
  "propertyNames": {
    "type": "string",
    "pattern": "^[A-Za-z][A-Za-z0-9._-]{0,63}$",
    "x-takoform-fieldPolicy": "portable-data-only-v1"
  }
}
```

The policy applies at every nested schema node. Boolean `false` is safe;
boolean `true`, `{}`, implicit open schemas, and object keywords without a
closed object proof are rejected. `allOf`/`anyOf`/`oneOf` and local `$ref` are
usable only when every branch or target proves a closed or non-object shape.
Arrays declare `items` (a safe schema or `false`) even when they use
`prefixItems`.

## Portable data

Definitions and JSON payloads are recursively checked for credentials, secrets,
tokens, account and operator configuration, target or pool selection,
capacity, backend managers, prices, billing, quotas, SLA/support policy,
executables, commands, scripts, source/adapter/runtime code, WebAssembly, and
plugins. A Host implementation or commercial configuration is not portable
Definition data.

The check compares normalized exact field names and reviewed token sequences,
not arbitrary substrings. Standard schema keys and explanatory prose remain
valid; sensitive fields such as `apiKeyValue`, `privateKeyPem`, `invoice`, and
`serviceOfferingId` do not.

`command`, `concurrencyTarget`, and `target` are admitted only under their
shape-dependent, bounded exceptions. A relation `target` is a closed object
with exact `apiVersion`, `kind`, and `name` plus one reviewed relation
annotation, or a discriminator-selected closed `oneOf` of such objects. These
proofs are consumed equally by every verifier and do not grant any client or
Host authority to widen Form semantics.

Version and retained-profile rules are centralized in
[`../versioning.md`](/en/spec/versioning).


</div>
