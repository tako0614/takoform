---
title: Host API overview
---

# Host API overview {#host-api-v1-とは}

Host API is the HTTP API for creating, reading, updating and deleting resources defined by Forms.
A Host is an implementation serving this API. It installs definitions for the
Forms it supports, accepts settings according to them and returns resource state.

This guide is non-normative. The [Host API v1 specification](/en/spec/host-api/v1)
defines implementation requirements.

## Discover the endpoint {#discovery-と-api-root、lifecycle-root}

Request `/.well-known/takoform/v1` to obtain supported API versions and endpoints.
Use the returned API endpoint to construct resource operation URLs.

| Purpose | URL |
| --- | --- |
| Discovery | `GET /.well-known/takoform/v1` |
| API root | `/apis/forms.takoform.com/v1` |
| Resource operations | `{api}/resources/{formGroup}/{kind}/{name}` |

Discovery returns one API version. The API endpoint uses the same origin as the
discovery URL. User information, queries, fragments and percent encoding are not
allowed in that endpoint. Plain HTTP is limited to loopback development.

Software release numbers are separate from the API version
`forms.takoform.com/v1`. Updating a library does not change the API URL.

## API operations {#wire-に入るもの、入らないもの}

The API defines discovery, validation, preparation, create/update/read/delete/import,
observation, concurrency control, asynchronous operations and errors.

The common API does not define the meaning of an individual Form or which backend
a Host uses. Resource-specific operations belong to the Interfaces and Bindings
referenced by the Form.

## Select an exact Form {#四要素の-formref}

All four FormRef fields identify one definition. This illustrates the shape:

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.3.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

All four values need to match. `latest`, an omitted version or a name-only
reference cannot substitute for them. An unresolved definition produces
`form_unknown` before the resource is changed.

## Identity and concurrency {#identity-は三つの値で見る}

- `uid`: identity issued on creation. Deleting and recreating the resource changes it.
- `generation`: advances with user-requested state changes, starting at `1`.
- `revision`: also advances with Host-returned state/output changes, starting at `1`.

Creation uses `If-None-Match: *`. Updates, observation, preparation of existing
resources and deletion use the concurrency preconditions specified for each operation.

Missing required preconditions produce `invalid_argument`; stale generations
produce `generation_conflict`, stale revisions produce `revision_conflict`, and a
recreated resource produces `uid_mismatch`. Check the operation inventory for details.

## Errors {#閉じた-error-語彙}

[`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
defines error codes, HTTP statuses and retryability. Implementations cannot add
their own common error codes.

## Schemas and operation inventory {#machine-document}

| File | Contents |
| --- | --- |
| [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json) | Operations and concurrency checks |
| [`host-discovery.schema.json`](https://forms.takoform.com/schemas/v1/host-discovery.schema.json) | Discovery |
| [`form-ref.schema.json`](https://forms.takoform.com/schemas/v1/form-ref.schema.json) | FormRef |
| [`host-api-wire.schema.json`](https://forms.takoform.com/schemas/v1/host-api-wire.schema.json) | Resources and errors |
| [`operation.schema.json`](https://forms.takoform.com/schemas/operations/v1/operation.schema.json) | Asynchronous operation records |
| [`host-support-profile.schema.json`](https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json) | Host support |

## Read next {#次に読む}

- [Getting started](/en/start/) — package verification and API examples.
- [Common model](/en/model/) — definitions, packages and Snapshots.
- [Conformance checks](/en/conformance/) — reading reports.
- [Versioning and compatibility](/en/spec/versioning) — detailed rules.
