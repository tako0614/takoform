# Takoform

Takoform defines and verifies portable, data-only resource contracts called
Forms. Publishers describe desired state once; clients and Hosts consume the
same exact contract. Core verifies packages, compiles immutable Snapshots, and
calls compatible Hosts through one API. It is an experimental, neutral
resource-contract project.

## A checked-in Form example

- package index:
  [`conformance/takoform-v1/generic-host/external-family/counter-reservation/package-index.json`](conformance/takoform-v1/generic-host/external-family/counter-reservation/package-index.json)
- Definition:
  [`conformance/takoform-v1/generic-host/external-family/counter-reservation/definition.json`](conformance/takoform-v1/generic-host/external-family/counter-reservation/definition.json)

Run from the repository root:

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

```json
{
  "packageDigest": "sha256:3af4d09e2939b533a800fba945a85fb7a168ca8fae3454727a028505e38981d7",
  "formRef": {
    "apiVersion": "resources.publisher.example",
    "kind": "CounterReservation",
    "definitionVersion": "0.1.0",
    "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
  },
  "fileCount": 1,
  "payloadBytes": 1689
}
```

The result proves the package index and payload closure, exact FormRef,
Definition digest, and payload size. The Definition uses the `attachment` role,
requires Host API v1, supports `create`, `read`, `delete`, `import`, and
`observe`, and declares an exclusive `/target` relation to an exact
`RangeSequence` Form. It is a conformance fixture, not a built-in family or
catalog entry.

## Current Host API and Core artifact

The current Host API is the literal v1 lane:

- discovery: `GET /.well-known/takoform/v1`;
- API root: `/apis/forms.takoform.com/v1`;
- wire contract: [`spec/host-api/v1.md`](spec/host-api/v1.md); and
- generic corpus: [`conformance/takoform-v1/generic.json`](conformance/takoform-v1/generic.json).

This source is distributed as the Core **v1.1.0** Go software/module artifact.
That artifact SemVer identifies Core, not the Host protocol: there is no Host
API v1.1, and the routes above remain unchanged.

The normative model is split into:

- [`spec/form-definition/`](spec/form-definition/) — exact four-field FormRef
  and portable desired, observed, and output shapes;
- [`spec/form-package/`](spec/form-package/) — one closed data-only package for
  one exact Form;
- [`spec/core/`](spec/core/) — deterministic compilation into one immutable
  Snapshot;
- [`spec/host-api/`](spec/host-api/) — discovery, lifecycle requests,
  asynchronous Operations, identity fences, and portable errors;
- [`spec/interface-contract/`](spec/interface-contract/),
  [`spec/binding-contract/`](spec/binding-contract/),
  [`spec/artifact-transport/`](spec/artifact-transport/), and
  [`spec/standard-services/`](spec/standard-services/) — digest-bound data
  contracts; and
- [`spec/trust/`](spec/trust/) and
  [`spec/project-lifecycle.md`](spec/project-lifecycle.md) — caller-supplied
  trust inputs and separate Form lifecycle facts.

Requirement keywords and conformance classes are defined in
[`spec/conformance.md`](spec/conformance.md). Compatibility rules are in
[`spec/versioning.md`](spec/versioning.md), and the publication/change policy
is in [`spec/publication-freeze.md`](spec/publication-freeze.md).

## Version model

Takoform has exactly two domain version axes:

| Axis | Current identity | Meaning |
| --- | --- | --- |
| Host API lane | `forms.takoform.com/v1` | Compatibility of the Host discovery and wire contract |
| Form definition | each Form's `definitionVersion` | Compatibility of that Form's portable desired-state contract |

A reverse-DNS Form group is a namespace, not a version. Package and schema
`$id`, package digest, Interface/Binding ref, trust record, client release, and
other evidence identify their own bytes or readers. The Go module
`github.com/tako0614/takoform` uses `v1.1.0` as a software artifact identity;
it is not a third domain version axis. There is no Host API v1.1.

## Publisher equality

Every publisher uses the same FormRef, package validation, canonical digest,
trust, revocation, Snapshot, installation, Host support, and activation paths.
An operator selects provenance and policy; Core has no privileged publisher
allowlist or `official` bit. Verification, installation, support, activation,
and a commercial Offering remain separate facts.

## Public Core packages

- [`formpackage`](formpackage/) validates canonical data-only packages, exact
  FormRefs, schema closure, fixtures, and revocation documents.
- [`snapshot`](snapshot/) compiles verified, digest-pinned contracts into an
  order-independent immutable graph and returns no partial Snapshot on failure.
- [`hostclient`](hostclient/) implements discovery, support, artifact,
  Operation, identity-fence, and Resource lifecycle calls for Host API v1.
- [`trust`](trust/) verifies caller-supplied publisher policy, signed subjects,
  Sigstore bundles, trusted roots, and revocation state offline.

The [generic conformance corpus](conformance/takoform-v1/generic.json) and
[public schemas](spec/schemas/) are the reference inputs. The command-line
tools expose the same libraries and fail closed on invalid input. Form source,
Host implementation, client projection, backend state, and commercial policy
are outside this neutral contract.

## The takoform.com site

This repository owns the source, build, and deploy entrypoint of the API and
common-model-only `takoform.com` site. It publishes the Host API v1 contract,
the publisher-neutral common model, the exact bytes of every public schema at
the path its `$id` names, the conformance language, the public Core release
history, and the decision index.

It does not publish Form definitions, per-Form examples, publisher catalogs,
Form-specific conformance, or client adapter pages; each belongs to the
publisher or adapter that owns it. Realized CDN, DNS, account, zone, and
credential state belong to the publishing operator, not to this repository.

```console
bun run site:dev                    # read it locally
bun run build:site                  # build and verify the served surfaces
bun run deploy -- takoform-site --status
```

Layout, the generated trees, and the operator publishing procedure are in
[`docs/site.md`](docs/site.md).

## Development

```console
bun install --frozen-lockfile
bun run check
```

The gate checks source ownership, immutable record pins, schema closure,
formatting, static analysis, portable tests, generic conformance, and
standalone builds. It does not publish or mutate a Resource.

## License

MIT
