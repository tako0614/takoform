---
title: Host API v1
description: Entry point to the Host API v1 specification, common model, schemas and verification documentation.
---

# Host API v1 {#v1}

API specifications, the common model and verification resources for existing v1 Hosts and clients.
The [Go libraries](#go) in the [Takoform repository](https://github.com/tako0614/takoform)
implement v1. References to the "current" lane in the v1 documents mean this
v1 contract; the separate v2 specification does not change v1 requirements.

## API specification {#api}

- [HTTP API specification](/spec/host-api/v1) — Endpoints, requests, responses and operation rules.
- [Versioning and compatibility](/spec/versioning) — Version handling and compatibility boundaries.

## Resource and connection model {#model}

- [Form Definition](/spec/form-definition/) — Resource definitions.
- [Form Package](/spec/form-package/) and [Snapshot](/spec/core/) — Distribution and resolution.
- [Interface](/spec/interface-contract/) and [Binding](/spec/binding-contract/) — Connection contracts.
- [Trust and revocation](/spec/trust/) — Verification rules for v1.

## Use the Go libraries {#go}

The module `github.com/tako0614/takoform` implements v1 in four library packages:

- [`hostclient`](https://pkg.go.dev/github.com/tako0614/takoform/hostclient) — A transport-only v1 client: Discovery, Form and support checks; prepare, apply, read, observe, import, and delete with UID and generation fences; Operation polling; and artifact upload. It never selects a backend or manages credentials.
- [`formpackage`](https://pkg.go.dev/github.com/tako0614/takoform/formpackage) — Verifies data-only Form Packages without fetching them or running extensions.
- [`snapshot`](https://pkg.go.dev/github.com/tako0614/takoform/snapshot) — Compiles acquired Form Packages into one immutable Snapshot.
- [`trust`](https://pkg.go.dev/github.com/tako0614/takoform/trust) — Verifies caller-selected publisher identities, Sigstore bundles, and revocation checkpoints without network access.

Add a package at the latest release:

```console
go get github.com/tako0614/takoform/hostclient@latest
```

The command-line tools `form-package`, `generic-conformance`, and `takoform-trust` install the same way, for example `go install github.com/tako0614/takoform/cmd/form-package@latest`; [verification tools](/conformance/) shows them in use.

The example below, from [`hostclient/example_test.go`](https://github.com/tako0614/takoform/blob/main/hostclient/example_test.go), creates one Resource against a loopback fixture defined in that file, not a real Host. It is a Go example test, so `go test ./hostclient -run Example` runs it and checks its output.

<<< @/../hostclient/example_test.go#client{go}

`hostclient.New(endpoint, token, nil)` sends a non-empty `token` as `Authorization: Bearer <token>` on every request, including Discovery; the example's fixture needs none, so it passes `""`. With a nil HTTP client it refuses redirects, so the credential is never resent to a location the client did not negotiate. If you pass your own `*http.Client`, give it the same rule: `CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }`.

`endpoint` is the Host's bare origin, such as `https://host.example`: no path (a trailing `/` is ignored), query, fragment, or user information, and HTTPS unless it is a loopback development origin (`localhost` or a loopback IP address). `Discover` must succeed before any other API call; calls made earlier return an error. The client rejects an API endpoint that Discovery advertises on a different origin, so the bearer credential stays with the origin you configured.

To author a v1 Form Package, write the Form Definition, then build and verify the package. This example from [`formpackage/example_test.go`](https://github.com/tako0614/takoform/blob/main/formpackage/example_test.go) validates a synthetic Definition, computes its schema digest, writes the package index, verifies the package, and shows that a changed payload is rejected. The Definition follows the [v1 Form Definition schema](/schemas/v1/form-definition.schema.json), and `formpackage.VersionlessFamilyPackageAPIVersion` is the package index format `packages.forms.takoform.com/v1alpha5` ([schema](/schemas/v1alpha5/package-index.schema.json)), the package profile v1 uses:

<<< @/../formpackage/example_test.go#definition{go}

<<< @/../formpackage/example_test.go#authoring{go}

## Verification and tools {#tools}

- [Schema index](/schemas/) — Published JSON schemas.
- [Conformance](/spec/conformance) and [verification tools](/conformance/) — What checks cover and where they stop.
- [Takoform Provider versions](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#choose-a-provider-version) — Which OpenTofu / Terraform Provider version speaks your Host API version.
