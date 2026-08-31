# Takoform

Takoform is the independent home of the **Takoform Specification and Core**:
the normative desired-state contract, neutral schemas, data-only Form Package
verification, immutable Snapshot compilation, the Host API client, offline
trust verification, and generic conformance.

It is an experimental specification and tooling project. It is not a cloud
catalog, a hosted control plane, a Terraform Provider, or a claim that unlike
service semantics can be made portable by renaming fields.

## Current version streams

Takoform has exactly four named version streams. Host API and Form versions are
domain compatibility; Core/library and Provider versions identify independently
released software:

| Stream | Current identity | Meaning |
| --- | --- | --- |
| Host API major | `forms.takoform.com/v1` | Compatibility of the Host discovery and wire contract |
| Form definition | each Form's `definitionVersion` | Compatibility of that Form's portable desired-state contract |
| Core/library | `v0.1.0` candidate | SDK, CLI, verifier, compiler, and client implementation compatibility |
| Provider | independent SemVer | Terraform/OpenTofu schema, state, import, diagnostics, and mapping compatibility |

These streams never advance one another implicitly. A Core or Provider release
does not mint a Host API lane or change a Form identity, and a Form release does
not require a Core or Provider bump.

The package envelope, such as
`packages.forms.takoform.com/v1alpha5`, is a wire-format/schema identity for a
manifest. It is not a fifth product release stream. A package digest identifies
the exact distribution bytes, while the Form's `definitionVersion` carries the
desired-state compatibility version. A reverse-DNS Form group is a namespace,
not a version.

## Historical Specification receipt

Specification 1.1 is an immutable historical receipt, not a current version
stream. Its exact source snapshot, tag, release, and evidence remain in the
append-only [`Specification release ledger`](release/specification-releases.json)
and the extracted predecessor evidence under
[`docs/extraction/history/`](docs/extraction/history/README.md). Specification
1.0 was never published, is withdrawn, and cannot be reused. There is no
current Specification 1.0 or 1.1 release lane; the receipt did not publish the
Host API v1, a Form, a package, a Provider, Host support, activation, or an
Offering.

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
- append-only schema identities and historical publication receipts; these
  records identify exact bytes and are not an additional release stream.

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

## Release boundaries

The four streams above have independent owners, evidence, and cadence. The
current Host API v1 remains the exact lane documented above; its wire identity
does not become `v1.1`, and a new endpoint, field, error, feature, constraint,
state transition, or discovery member waits for a separately justified Host API
v2 proposal. The Core candidate and any Provider candidate are source evidence,
not publication proof. Form and package publishers make their own release
decisions under the exact identity and digest rules in
[`spec/versioning.md`](spec/versioning.md).

## License

MIT
