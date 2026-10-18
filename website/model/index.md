---
title: The v2 model
description: Understand what Forms, Hosts, Resources, Operations, and generations represent in Host API v2.
prev:
  text: Guides by role
  link: /guides/
next:
  text: Create a Form
  link: /authoring/
---

# The v2 model {#model}

v2 distinguishes a Form that defines meaning, a Host that implements it, a Resource managed by that Host, and an Operation that reports the progress of a change. This separation prevents the meaning of a Form from being mistaken for what a particular Host actually offers.

## Form and Host {#form-host}

A Form is a specification published by its author at an exact HTTPS URL. Each Form URL names one version of the contract, and its author keeps that meaning, so a changed contract gets a new URL; the URL need not contain a version number. It defines the meaning of a Resource's `spec`, `observed`, and `output`, as well as operation requirements. A Form is not itself an API server or execution environment.

A Host implements Forms and exposes Resource operations to authenticated clients. Discovery describes the Host's endpoint and capabilities; `support` reports support for an exact Form URL. Form publication, Host support, and a caller's authorization are separate facts.

## Desired and observed Resource state {#resource-state}

A Resource has a Host-unique UID, Form URL, Space, name, generation, and state. Its UID is not reused after deletion.

- `spec`: the desired value accepted from the client. Updates replace the complete document.
- `observed`: the latest state the Host has checked; it may lag behind desired state.
- `output`: values defined by the Form for using the Resource, such as a connection address; it may be empty. It is not a second channel for desired state.
- `generation`: the accepted desired-state generation. It begins at creation and advances as updates or deletion are accepted.
- `observedGeneration`: the latest generation the Host has confirmed as realized, or 0 before any. It can stay behind `generation`, for example while a newer change is unfinished or after it fails; the Host advances it to a newer generation only after confirming that generation.
- `observedAt`: when the Host last verified `observed` and `output`, or `null` before any verification; not necessarily when a GET request arrived.

An Operation succeeding, a Host observing a generation, and an application being available are not equivalent. Availability requires other evidence explicitly defined by the Form and Host.

## Operations and retries {#operations-retry}

Each accepted create, update, or delete produces an Operation; a request rejected before acceptance returns a Problem and has none, though a `5xx` or proxy error alone does not prove rejection. The Host reports its ID, Resource, action, generation, status, effect, and any error. A client reads the Operation and may then fetch the Resource again. GET is a read and does not start processing.

To retry the same operation, a client reuses the same Idempotency-Key with the identical request. A new operation uses a new key. Discovery gives the replay window (`replayWindowSeconds`). A key is scoped to the Host, the API version, and your stable [principal](/glossary#principal), not to the credential bytes; the Host's authentication documentation explains how the principal survives credential rotation. Stop resending before your first send time plus that window: after it, a key may no longer prevent a duplicate, so reconcile from the Operation and Resource instead.

## Generation conditions and conflicts {#generation-conflicts}

Update and delete requests carry the generation that was read in `Takoform-Expected-Generation`. If the Resource has advanced, the Host does not silently reapply stale intent. The client reads current state and decides which change it still intends to make.

## How this differs from v1 {#v1-terms}

FormRef, Form Package, Snapshot, and `schemaDigest` are v1 contract terms. They are not alternate names for a v2 Form URL or Resource state. Consult the [frozen v1 specification](/spec/host-api/v1) for v1. The v2 normative contract is in the [overview](/spec/host-api/v2/), [HTTP API](/spec/host-api/v2/http), and [Form requirements](/spec/host-api/v2/forms).
