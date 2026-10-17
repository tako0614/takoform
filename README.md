# Takoform

Takoform is an HTTP protocol for managing resources across independent Host
implementations. A **Form** defines a resource's inputs, outputs and behavior.
A **Host** implements the Forms it supports. A **client** submits changes and
follows their results through the common API.

For example, a client can request a key/value entry, follow the accepted
Operation, and read the Resource's observed state. The Form specifies what that
entry means; the Host owns its execution, access control and recovery.

Read the English documentation at [takoform.com](https://takoform.com/).
This repository contains the API contracts, implementation guides, public
schemas, v1 Go libraries and verification tools. It does not supply a running
Host or a central Form catalog.

## Start reading

| Goal | Start here |
| --- | --- |
| Understand the model | [Concept guide](website/model/index.md) |
| Follow a resource from creation to deletion | [Getting started](website/start/index.md) and [HTTP examples](spec/host-api/v2/examples.md) |
| Use the API | [Using v2](website/use/index.md) and [HTTP reference](spec/host-api/v2/http.md) |
| Implement a client | [Client guide](website/client/index.md) and [HTTP reference](spec/host-api/v2/http.md) |
| Create a Form | [Authoring guide](website/authoring/index.md) and [Form requirements](spec/host-api/v2/forms.md) |
| Implement a Host | [Host guide](website/host-api/index.md) and [v2 conformance requirements](spec/host-api/v2/http.md#conformance) |
| Maintain a v1 implementation | [v1 reference](spec/host-api/v1.md) and [migration guide](spec/host-api/v2/migration.md) |

The guides use Host API v2. Their example domains describe fictional Hosts and
Forms. To use the API, choose a Host and client that explicitly support your
API version and exact Form.

## Contracts and implementation support

| Surface | What this repository provides |
| --- | --- |
| Host API v2 | Fixed English [model](spec/host-api/v2/README.md), [HTTP contract](spec/host-api/v2/http.md) and [Form requirements](spec/host-api/v2/forms.md); illustrative examples and implementation guides |
| Host API v1 | Retained fixed contract, public schemas and Go implementations in [formpackage](formpackage/), [snapshot](snapshot/), [hostclient](hostclient/) and [trust](trust/) |
| Local verification | v1 package and Snapshot checks, plus a caller-driven [v2 HTTP baseline probe](conformance/v2/) |

The Go libraries implement v1; they are not a v2 SDK or a prerequisite for
reading the v2 specification. The v2 probe tests a limited sequence through a
caller-supplied transport and disposable fixture. Its fake tests validate the
probe itself, not a real Host.

Both contracts have fixed normative bytes. Guides and examples explain them
without adding requirements. Protocol changes require a different API major;
Core module and independent client releases have their own software versions.
See the [specification index](spec/README.md) for the contract map and the
[publication guide](spec/publication-freeze.md) for change boundaries.

Form publishers own their definitions and distribution. Hosts document their
support, authentication, targets and service terms. Client adapters, including
[OpenTofu / Terraform tools](https://github.com/tako0614/terraform-provider-takoform),
document their own installation and compatibility.

## Run the v1 tools locally

From the repository root, fetch the Go dependencies, then verify the synthetic
fixtures:

```console
go mod download
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

After dependencies are available, these verifier commands read local data and
do not need network access or change resources. The first reports the package
digest, FormRef and payload inventory. The second reports artifact checks and
Snapshot compilation, including input-order independence and rejection of
partial results. These checks do not exercise a Host's resource lifecycle.
See [verification coverage](website/conformance/index.md) for interpreting the
results.

## Develop the documentation

Use the Bun version declared in [package.json](package.json) and the Go version
declared in [go.mod](go.mod):

```console
bun install --frozen-lockfile
bun scripts/site.mjs --write
bun run check
bun run site:preview
```

Edit guides in `website/` and specification explanations in `spec/`. Generate
the website mirrors from their sources; do not edit generated pages, frozen
contracts or schema bytes. The read-only `check` gate covers source boundaries,
historical records, contract freezes, generated pages, links, Go code and the
site build. It does not publish anything.

The [site development guide](docs/site.md) covers generation, local browser
checks and the separate operator publication workflow. [Extraction records](docs/extraction/)
preserve this repository's provenance rather than current product status.

## License

[MIT](LICENSE)
