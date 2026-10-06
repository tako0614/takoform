---
title: Implementing Host API v2
description: Design the durability boundary that keeps Resources, Operations, and retry records coherent across restarts.
---

# Implementing Host API v2 {#host-api}

A v2 Host manages more than HTTP responses: it owns accepted work, Resource generations, and the state verified at its execution target. This guide focuses on the durability boundary. The [HTTP API](/spec/host-api/v2/http) is the source for exact paths, statuses, and retention requirements.

## Make acceptance one durable fact {#acceptance}

Before dispatching a mutation, validate authentication and authorization, Form support, input, references, and generation conditions. On acceptance, persist the Resource and Operation together with the Idempotency-Key mapping as one durable acceptance. Concurrent requests must converge on one winner; do not allow partial records such as an Operation without its Resource, or a backend change without its replay record.

At minimum, retain enough information to identify and resume the original request after restart:

- Stable principal, API version, Idempotency-Key, and the method, path/query, generation condition, and JSON value needed to match a retry.
- Host-issued Resource UID, Form URL, Space, name, accepted desired `spec`, and current generation.
- Operation ID, action, generation, status/effect, acceptance time, and retention deadline.
- Execution state bound to that Operation and the backend identity needed to verify its outcome.

The key scope is `(Host, API version, stable principal, key)`. The same key and request return the original Operation; reusing the key for a different request is rejected as a conflict. Do not discard unfinished Operations or unknown effects at an ordinary retention deadline. The common contract does not choose a database, queue, ORM, or encryption scheme. It requires durability and concurrency control that preserve these associations.

## Bind execution to the original Operation {#dispatch}

The HTTP handler and backend work may have different lifetimes. If work continues in a separate worker, provide a durable notification or equivalent recovery path that can resume accepted Operations. Duplicate delivery and restart must continue the original Operation—not create a new UID, Operation, or backend object. While an effect is unresolved, reject another mutation on that UID as `resource_busy`.

`GET /operations/{id}` reads current recorded state. It does not resend Create/Update/Delete or start reconciliation merely because a client polled. Background execution advances work independently. Resource GET returns the last verified `observed`, `observedGeneration`, and `observedAt`. An implementation may perform read-only refresh during GET, but it must not start effectful work or label unverified values as observed.

## Recover at each restart or lost-ack point {#recovery}

| Failure point | Durable state and recovery action |
| --- | --- |
| Before acceptance is recorded | No Operation or backend effect was accepted. Revalidate the request; if accepted, create the durable record once. Requests arriving with the same key converge on that record. |
| After acceptance, before dispatch | Restore `queued/effect:none` and the original dispatch data, then advance that Operation. Do not reissue a UID or key. |
| After dispatch, before recording the backend result | Do not assume execution never happened. Set `reconciling/effect:unknown` and check using the saved backend identity. Block a new mutation until the result is established; a timeout alone cannot mean `failed/effect:none`. |
| After backend success, before terminal state is recorded | Reconcile or read back the backend, then advance the original Operation when success is verified. Do not create a second Operation to repeat the successful effect. |

If only the client acknowledgement was lost and the Host's acceptance record remains, replaying the same request with the same key returns the same Operation's current state. If authorization has been revoked, the Host may hide that state with `403` or `404`.

## Keep success separate from observation {#observation}

An Operation reports progress and effect for one Form-defined management action. `succeeded/effect:complete` means that action completed; it is not a general service-health result. Keep the accepted desired value in Resource `spec` and update `observed` only with values verified at the backend. After failure, preserve the Resource and any known partial-effect mapping so the Form's same-UID Update/Delete recovery remains possible.

Once these obligations are met, the choice of worker, database, and queue arrangement belongs to the Host. Follow the [HTTP API contract](/spec/host-api/v2/http) for normative statuses, retention, `404`/`410`, and problem details.
