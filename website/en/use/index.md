---
title: Use from OpenTofu / Terraform
description: Entry point for using Host API v1 from Terraform / OpenTofu configuration. Discovery, routes, the exact FormRef, the version axes, and what belongs to the provider or the publisher.
---

# Use from OpenTofu / Terraform {#use}

This page is for people who write Terraform / OpenTofu HCL and want to use Takoform
Forms from an existing provider. Takoform does not designate an official provider.
Which provider you use is your choice, not a Takoform decision. If your provider
speaks Host API v1, your configuration talks to the same API as any Takoform Host.

This page is a guide. [Host API v1](/en/spec/host-api/v1) defines the requirements.

## What this site publishes {#boundary}

- This site publishes the Host API v1 contract and the data model shared across
  publishers (FormRef, Form Definition, Form Package, Snapshot).
- Resource names, state handling, import, diagnostics and release numbers belong to
  the provider you use. Takoform does not put them in the API specification.
- The settings, examples and definition version of an individual Form live on the
  site of the publisher that publishes it. takoform.com serves the API and the common
  model only; it does not serve individual Forms.

## Endpoint and routes {#api}

Start with discovery. It returns one API, `forms.takoform.com/v1`, with API root
`/apis/forms.takoform.com/v1`. That endpoint must be on the same origin as the
discovery document. The table lists the routes under that root.

| Purpose | Request |
| --- | --- |
| Forms this Host has | `GET /forms` |
| A Form's Definition (including `desiredSchema`) | `GET /form-definitions/{formGroup}/{kind}` |
| Validate a submitted document (no mutation) | `POST /resources/validate` |
| Review a change (no mutation) | `POST /resources/prepare` |
| Create, read, update, delete | `PUT` / `GET` / `DELETE /resources/{formGroup}/{kind}/{name}` |
| Refresh Host-observed state | `POST /resources/{formGroup}/{kind}/{name}/observe` |
| Adopt an existing resource | `POST /resources/{formGroup}/{kind}/{name}/import` |
| Long-running operations | `GET /operations/{id}`, `POST /operations/{id}/cancel` |
| Artifact upload | `POST /artifacts/uploads`, `PUT /artifacts/uploads/{uploadId}/blobs/{sha256}`, `POST /artifacts/uploads/{uploadId}/commit` |
| Artifact and blob reads, discarding an upload | `GET /artifacts/{manifestDigest}`, `HEAD /artifacts/blobs/{sha256}`, `DELETE /artifacts/uploads/{uploadId}` |
| Declared Form support | `GET /support/forms`, `GET /support/forms/{formGroup}/{kind}/{definitionVersion}` |
| Declared Interface, Binding and external protocol support | `GET /support/interfaces/{name}/{version}`, `GET /support/bindings/{name}/{version}`, `GET /support/standard-services/{protocol}` |

[`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
is authoritative for operations, HTTP statuses, errors and retryability. `GET /forms`
and the `/support/...` answers are what the Host declares; they do not show that a Form
is published or that it is usable in production.

## Address one exact Form {#formref}

A resource is addressed by an exact FormRef of four fields.

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.3.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

- `apiVersion`: the versionless reverse-DNS publisher group.
- `kind`: the Form kind.
- `definitionVersion`: the version of that one Form.
- `schemaDigest`: the RFC 8785 digest of the immutable Definition.

All four values have to match. `latest`, an omitted version or a group-and-kind
alias cannot substitute for them. A version belongs in `definitionVersion` and never
becomes a second path segment. An unresolved definition produces `form_unknown` before
the resource is changed.

## Version axes {#versions}

Two axes carry compatibility.

| Axis | Identity | What it versions |
| --- | --- | --- |
| Host API | `forms.takoform.com/v1` | Host discovery and the wire contract |
| Form definition | `definitionVersion` in one exact FormRef | That Form's desired-state contract |

Core library and provider version numbers are ordinary software-artifact semver. They
are not Takoform API or Form versions, so updating a library or a provider does not
change the API URL. There is no intermediate lane such as `/v1.1`.

## From prepare to apply {#lifecycle}

1. `POST /resources/prepare` reviews the change. `prepare` does not mutate the resource
   and returns a `review.prepareDigest`.
2. `PUT /resources/{formGroup}/{kind}/{name}` applies it with that `review`. Creation
   uses `If-None-Match: *`; updates use a generation fence such as
   `Takoform-Expected-Generation`. A missing fence is `invalid_argument` and a stale
   generation is `generation_conflict`.
3. A `202 Accepted` apply becomes an Operation. Poll `GET /operations/{id}` to completion.

`generation` advances when the desired state changes; `revision` also advances when
Host-observed status or outputs change. Do not raise `generation` by hand. A mutation
carries an idempotency key so that repeating it converges; reusing that key with a
different payload is `invalid_argument`.

Mapping Terraform or OpenTofu state and plan onto these operations belongs to the
provider you use. When local state and the Host's `generation` / `revision` diverge,
read the resource with `GET /resources/{formGroup}/{kind}/{name}`, take the current
generation, and retry. A timeout does not mean that nothing changed.

## Check before using it from configuration {#check}

| Check | Where |
| --- | --- |
| Your provider speaks Host API v1, and how it names resources and stores state | That provider's documentation |
| The Host installs the exact FormRef you use and admits the current caller | The Host, plus `GET /forms` and the `/support/...` answers |
| An individual Form's settings, examples and definition version | The site of the publisher that publishes it |
| Package verification, installation, support, activation, commercial offering | The Host and the publisher, separately |

Package verification, publication of a Form, Host support, activation and a commercial
offering are separate facts. The examples on this site do not establish any of them.

This site does not designate a provider. One implementation that talks to Host API v1
from OpenTofu / Terraform is
[`terraform-provider-takoform`](https://github.com/tako0614/terraform-provider-takoform);
its own documentation is authoritative for its HCL, state and versioning.

## Read next {#next}

- [Host API v1](/en/spec/host-api/v1): endpoints, FormRef, concurrency and errors.
- [Host API overview](/en/host-api/): discovery through resource operations.
- [Use a Host from Go](/en/client/): the same sequence through Core's client.
- [Common model](/en/model/): FormRef, Definition, Package and Snapshot.
- [Versioning and compatibility](/en/spec/versioning): the version rules.
