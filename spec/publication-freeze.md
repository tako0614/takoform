# Current publication and change boundary

Takoform has exactly four version streams: Host API major, each Form's
`definitionVersion`, Core/library SemVer, and Provider SemVer. It has no
independent numbered document version, document release train, selectable
document maturity label, or lockstep project release.

Raw predecessor records under
[`docs/extraction/history/`](../docs/extraction/history/README.md) and immutable
Git history remain evidence of older publication. They are not current writer
authority, compatibility rules, or inputs to new publication.

## Host API v1 stability

The current Host API is exactly `forms.takoform.com/v1`, discovered at
`/.well-known/takoform/v1` and served at `/apis/forms.takoform.com/v1`. Its
normative closure is [`release/host-api-v1.json`](../release/host-api-v1.json),
including [`host-api/v1.md`](host-api/v1.md) and
[`host-api/operations-v1.json`](host-api/operations-v1.json).

Editorial corrections MAY clarify prose only when every conforming peer's
accepted, sent, stored, and observed behavior is unchanged. A new endpoint,
field, error, feature, constraint, state transition, discovery member, or
changed lifecycle meaning is incompatible and requires a separately justified
Host API v2. There is no Host API v1.1 lane or calendar checkpoint.

## Independent publication boundaries

Editing `main` does not publish a Host API, Form, Form Package, Interface,
Binding, Core library, Provider, Host capability, activation, or Offering.
Each owner publishes its own exact identity and evidence:

- a Form publisher owns each Form's `definitionVersion` and package digest;
- this repository owns Core/library SemVer and the Host API v1 contract;
- Provider SemVer belongs to the Provider repository's independent release line; and
- a named Host or operator owns support, activation, capacity, and live state.

A schema identity is an exact wire artifact, not a fifth version stream.
[`release/public-schema-identities.json`](../release/public-schema-identities.json)
keeps active and verify-only schema bytes append-only. The schema-origin writer
is separately bound by
[`release/schema-origin-authority.json`](../release/schema-origin-authority.json)
and cannot mint a project-wide document version.

Official and third-party publishers use the same package, verification, trust,
revocation, installation, support, and activation mechanisms. Provenance may
differ, but the contract has no official privilege bit or bypass.

`bun run check` is a read-only portable gate. It does not publish, sign,
install, activate, deploy, or mutate a Resource.
