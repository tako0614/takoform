# Publication and change policy

The current Host API lane is the literal `forms.takoform.com/v1`. Editorial
clarifications keep this exact lane only when they change no accepted request,
response, error, lifecycle semantic, or peer obligation; every behavioral
change requires a new API major.

Takoform has exactly two domain version axes:

| Axis | Meaning |
| --- | --- |
| Host API lane | Compatibility of one exact discovery and wire-contract major |
| Form `definitionVersion` | Compatibility of one Form's portable desired-state contract |

Form groups are namespaces. Package, schema, Interface/Binding, trust, library,
client, Provider, and record identities identify their own bytes or evidence
and do not create another Takoform version axis.

## Immutable identities

The non-retired and verify-only schema identities are recorded in
[`release/public-schema-identities.json`](../release/public-schema-identities.json).
The signed internal record chain preserves publication evidence without
creating a public document-set version. Each record binds exact bytes and a
digest; withdrawal retains the bytes and prevents reuse of an occupied
identity.

## Change policy

Changes to a current contract update the relevant source, schemas, fixtures,
compatibility notes, and evidence together. Published bytes and occupied
identities are never overwritten, retagged, or silently relabelled; a breaking
change receives a new exact identity and the append-only ledgers retain the
predecessor.

Library and Provider releases and the Host API v1 wire remain separate from
Form maturity, package publication, Host support, client releases, and
commercial Offering decisions. A green `bun run check` validates the repository; it does
not publish, sign, install, activate, deploy, or mutate a Resource.

Normative contract links and authority classification are maintained in
[`spec/README.md`](README.md). Compatibility details are in
[`versioning.md`](versioning.md).
