---
title: The v2 model
description: Understand what Forms, Hosts, Resources, Operations, and generations represent in Host API v2.
---

# The v2 model {#model}

v2 distinguishes a Form that defines meaning, a Host that implements it, a Resource managed by that Host, and an Operation that reports the progress of a change. This separation prevents the meaning of a Form from being mistaken for what a particular Host actually offers.

## Form and Host {#form-host}

A Form is a versioned, immutable HTTPS URL for a specification published by its author. It defines the meaning of a Resource's `spec`, `observed`, and `output`, as well as operation requirements. A Form is not itself an API server or execution environment.

A Host implements Forms and exposes Resource operations to authenticated clients. Discovery describes the Host's endpoint and capabilities; `support` reports support for an exact Form URL. Form publication, Host support, and a caller's authorization are separate facts.

## Desired and observed Resource state {#resource-state}

A Resource has a Host-unique UID, Form URL, Space, name, generation, and state. Its UID is not reused after deletion.

- `spec`: the desired value accepted from the client. Updates replace the complete document.
- `observed`: the latest state the Host has checked; it may lag behind desired state.
- `output`: operation results or connection information defined by the Form; it may be empty.
- `generation`: the accepted desired-state generation. It begins at creation and advances as updates or deletion are accepted.
- `observedGeneration`: the generation represented by the current observation.
- `observedAt`: when the Host recorded that observation, not necessarily when a GET request arrived.

An Operation succeeding, a Host observing a generation, and an application being available are not equivalent. Availability requires other evidence explicitly defined by the Form and Host.

## Operations and retries {#operations-retry}

Create, update, and delete each produce an Operation. The Host reports its ID, Resource, action, generation, status, and result. A client reads the Operation and may then fetch the Resource again. GET is a read and does not start processing.

To retry the same operation, a client reuses the same Idempotency-Key with the identical request. A new operation uses a new key. Check the Host's Discovery response for replay scope and retention; a key may no longer prevent a duplicate after that period.

## Generation conditions and conflicts {#generation-conflicts}

Update and delete requests carry the generation that was read in `Takoform-Expected-Generation`. If the Resource has advanced, the Host does not silently reapply stale intent. The client reads current state and decides which change it still intends to make.

## How this differs from v1 {#v1-terms}

FormRef, Form Package, Snapshot, and `schemaDigest` are v1 contract terms. They are not alternate names for a v2 Form URL or Resource state. Consult the [frozen v1 specification](/en/spec/host-api/v1) for v1. The v2 normative contract is in the [overview](/en/spec/host-api/v2/), [HTTP API](/en/spec/host-api/v2/http), and [Form requirements](/en/spec/host-api/v2/forms).
