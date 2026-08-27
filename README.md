# Takoform

Takoform is the independent home of the **Takoform Specification and Core**:
the normative desired-state contract, neutral schemas, data-only Form Package
verification, immutable Snapshot compilation, the Host API client, offline
trust verification, and generic conformance.

It is an experimental specification and tooling project. It is not a cloud
catalog, a hosted control plane, a Terraform Provider, or a claim that unlike
service semantics can be made portable by renaming fields.

## Independent version axes

| Axis | Current identity | Meaning |
| --- | --- | --- |
| Specification | `1.1` | immutable normative source snapshot released from the predecessor repository |
| Core SDK and CLI | `v0.1.0` candidate | public Go packages and command behavior; released only after the W10 authority cutover |
| Host API | `forms.takoform.com/v1` | separate unpublished protocol candidate |
| Form Package format | `packages.forms.takoform.com/v1alpha5` | current data-envelope schema identity, not Core SemVer |

These axes never advance one another implicitly. Specification 1.1 did not
publish Host API v1, a Form, a Form Package, a Provider, Host support,
activation, or an Offering. Core `v0.1.0` will not mint an API v2 identity.

Specification 1.1 remains bound to its original immutable release:

- repository: `github.com/tako0614/terraform-provider-takoform`
- tag: `specification/1.1`
- annotated tag object: `e2c1ba71766a6b25cae0826df99c8906a7f3f20b`
- normative source commit: `00ae5ee4e2ea2eb62ea796499a93081374dc36b9`
- release commit: `35c03a76326c808e859aa77172e086f15a2aeb5d`
- source snapshot: `sha256:23a9b14dc79f46fae632624fc5c442f947f63565e9d7f9d0a614598b5027ae03`

This repository imports that receipt but never recreates or retags the release.
The extraction and future-writer handoff are recorded in
[`docs/extraction/w10-core-cutover.md`](docs/extraction/w10-core-cutover.md).

## Public Core packages

- [`formpackage`](formpackage) validates canonical data-only Form Packages,
  their exact FormRef and schema closure, package digests, fixtures, and
  append-only revocation documents.
- [`snapshot`](snapshot) compiles already verified, digest-pinned packages and
  contracts into one immutable, order-independent exact-identity graph. A
  failed compilation returns no partial Snapshot.
- [`hostclient`](hostclient) implements the neutral Host API client, including
  discovery, support, artifacts, asynchronous operations, identity fences, and
  Resource lifecycle calls.
- [`trust`](trust) verifies caller-supplied publisher policy, subject, Sigstore
  bundle, trusted root, and revocation state offline. It carries no ambient
  publisher trust.

The command-line tools expose the same libraries; command output is intended to
be machine-readable and fails closed.

## Publishers are equal at the Core boundary

A Form identity contains its reverse-DNS group, Kind, definition version, and
schema digest. It contains no `official` bit. The package schema, canonical
digest, signature verification, revocation checks, Snapshot compiler, Host
installation mechanism, support report, and activation decision are the same
regardless of who publishes it.

The only difference between publishers is provenance: who maintains the source
and which issuer, repository, workflow, ref, and revocation feed an operator
chooses to trust. Core accepts that policy as data supplied by the caller; it
does not ship a privileged publisher allowlist or a special activation route.

Package verification is not installation. Installation is not Host support.
Support is not activation. Activation is not a commercial Offering.

## Ownership boundary

Core owns:

- normative Specification source and active or verify-only schemas;
- package canonicalization, validation, trust formats, and generic conformance;
- immutable Snapshot compilation and the Host API client;
- future Specification and public-schema release records after the one-way
  authority handoff.

Core does not own:

- official or third-party Form source and publication workflows;
- Terraform/OpenTofu resource mappings, state, import, or Provider releases;
- a Host implementation, installation database, activation, backend capacity,
  credentials, billing, support, or customer traffic;
- a central Form catalog or a universal opaque Terraform resource.

The existing Provider and its immutable release history remain in
`github.com/tako0614/terraform-provider-takoform`. The official Form publisher
will be a separate `github.com/tako0614/takoform-forms` repository only after
its packages pass the same released path as independently maintained packages.

## Development

The portable complete gate is:

```console
bun install --frozen-lockfile
bun run check
```

The gate formats nothing and publishes nothing. It checks the final module and
ownership boundary, schema and release records, Go formatting/static analysis,
all portable tests, generic conformance, and standalone builds. No sibling
Provider checkout or `replace` directive is allowed.

## Version cadence

Specification majors receive deliberate compatibility review and normally no
more than one planned release per year. A minor is released only when a coherent
compatible body of change is ready; there is no obligation to mint one every
month. Proposals accumulate before publication. Forms, packages, Core, Hosts,
and Providers release on their own evidence and cadence.

API v2 remains proposal-only until a later explicit decision and release. This
repository does not publish or route it as part of W09-W19.

## License

MIT
