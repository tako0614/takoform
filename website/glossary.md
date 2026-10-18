---
title: Glossary
description: Key Host API v2 terms, organized around the distinction between Form and Host responsibilities.
---

# Glossary {#glossary}

## Form {#form}

A versioned specification URL published by its author. It defines Resource meaning and operation requirements; it is not itself a Host or execution environment.

## Host {#host}

A service that implements Forms and exposes a Resource API to authenticated clients. Support for a particular Form varies by Host.

## Discovery {#discovery}

The unauthenticated document at `/.well-known/takoform/v2` that a client reads first. It gives the API root (`baseUrl`), how to authenticate, optional capabilities, and limits such as the replay window. It lists no Forms, Resources, users, or secrets. See [Discovery and authorization](/spec/host-api/v2/http#discovery).

## Form support {#support}

A Host's answer, from its `support` endpoint, for one exact Form URL: whether it implements every operation that Form requires, listed in `operations`, and whether it accepts private inputs for it. Support is a technical declaration, not authorization, a capacity reservation, or a promise that an Operation will succeed. See [Form support](/spec/host-api/v2/http#support).

## Offering {#offering}

A Host-defined choice of terms for new Resources of a Form, such as a backend, limits, or pricing, selected by `id` and `revision`. Only a Host that advertises Offerings has them, and then every create names one. A Resource keeps the Offering it was created with; when the Host revises or withdraws that Offering, it does not silently change the Resource's price or backend. See [Offerings](/spec/host-api/v2/http#offerings).

## private inputs {#private-inputs}

Form-defined secret string values, sent in `privateInputs` only when both Discovery and Form support declare the capability. They are not the credentials a client uses to authenticate to the Host. A Host never copies them into the Resource, Operation, ordinary logs, or errors, and never exposes a simple hash of them. See [Private inputs](/spec/host-api/v2/http#private-inputs).

## Resource {#resource}

An object managed by a Host. It has a UID, Form URL, Space, name, generation, `spec`, `observed`, `output`, and other fields defined by the contract.

## UID {#uid}

The identifier a Host issues when it accepts a create. It is globally unique, never reused after deletion, and addresses the Resource in reads, updates, deletes, and Operations. The Resource's Form URL, Space, name, and any selected Offering never change for that UID. See [Resource](/spec/host-api/v2/http#resources).

## spec {#spec}

The accepted desired state of a Resource. Update replaces the complete document.

## observed {#observed}

The latest state checked by the Host. It can lag behind the desired generation.

## output {#output}

Operation results or connection information whose meaning is defined by the Form. It may be empty.

## generation / observedGeneration {#generation-observedgeneration}

`generation` identifies an accepted desired-state version. `observedGeneration` identifies the version reflected by `observed`.

## phase {#phase}

A Resource's management state: `pending`, `idle`, `deleting`, or `error`. `idle` means the last Operation succeeded and none is running; no phase, including `idle`, means the application is ready. See [Resource](/spec/host-api/v2/http#resources).

## Operation {#operation}

A record of progress and outcome for Create, Update, or Delete. A client reads it and may fetch the Resource again.

## status / effect {#status-effect}

An Operation's `status` is `queued`, `running`, `waiting_input`, or `reconciling` while it is unfinished; `succeeded` and `failed` are terminal. Its `effect` says what is established about the Form-managed resource: `none`, `partial`, `complete`, or `unknown` when effects cannot yet be determined. `unknown` is never terminal: the Operation stays `reconciling` until the outcome is established, which can need an operator. A timeout alone never means `none`. See [Operations](/spec/host-api/v2/http#operations).

## Idempotency-Key {#idempotency-key}

A client-provided key that identifies retries of the same request. A retry using the key must preserve the original request contents.

## replay window {#replay-window}

Discovery's `replayWindowSeconds`: the minimum period from a request's first acceptance during which resending it unchanged with the same Idempotency-Key returns the original Operation. A client that got no response measures the window from its own first send and stops automatic replay before it ends; after that it reconciles from Operation and Resource evidence instead of resending. See [Retry and retention](/spec/host-api/v2/http#retry).

## principal {#principal}

The user or comparable identity a Host derives from credentials, not the credential bytes. An Idempotency-Key is scoped to the Host, API version, and principal; the Host's authentication documentation explains how a principal stays identifiable and authorized when credentials rotate. See [Retry and retention](/spec/host-api/v2/http#retry).

## Space {#space}

A Resource scope within a Host. Naming a Space does not grant permission to use it.

## v1-only terms {#v1-terms}

FormRef, Form Package, Snapshot, revision, and `schemaDigest` belong to the frozen v1 contract. They are not synonyms for a v2 Form URL or Resource generation. See the [frozen v1 specification](/spec/host-api/v1).
