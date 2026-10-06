---
title: Implementing a v2 client
description: Design client recovery around durable intent records, replay deadlines, Operations, generations, and authorization changes.
---

# Implementing a v2 client {#client}

Read the Host's Discovery response for `baseUrl`, authentication guidance, and `replayWindowSeconds`. Build each request from the Form specification at its exact URL. Check `support`, Space authorization, and operation outcome as separate facts.

## Record intent before sending {#intent}

To identify the same operation across a client restart or a lost acknowledgement, persist one intent record before transmitting. Keep at least:

- Host origin and API version, Form URL, Space, and Resource name or UID.
- Method, API-root-relative path and query, and the complete request (including the generation condition and complete `spec` for Update).
- An Idempotency-Key created for this intent and its initial send time.
- The replay window read from Discovery. Do not reset the initial time on each retry.
- After a response, the Operation ID, Resource UID, accepted generation, `Location`, and `retainUntil`.

Do not copy authentication credentials into the intent log; use the client's authentication manager. If a Form uses private inputs, do not write those values to ordinary logs or public state; follow the HTTP contract's secret handling.

An Idempotency-Key is not reusable merely because a request body happens to match. It identifies one user intent while that request is being retried. A new desired value or distinct change uses a new key, even on the same Resource.

## Decide from the outcome {#decisions}

| Outcome | Client action |
| --- | --- |
| `202 Accepted` | Wait `Retry-After`, then GET the `Location` or Operation ID. Follow that Operation to a terminal state and reread the Resource. Do not create another mutation. |
| Lost response, still within replay window | Resend the stored method, path/query, body, and key unchanged. Do not alter the body or create a new key. The replay returns the original Operation. |
| Operation is `reconciling` / `effect: unknown` | Retain the UID and Operation ID as unresolved and continue checking the Operation. Do not send another mutation to that UID until the Host resolves the original backend identity. GET is not a substitute for recovery work. |
| `409 generation_conflict` | The request was not accepted and has no Operation. GET the current Resource and decide what change is still intended. If continuing, create a new intent with the current generation and a new key. |
| Replay window near or past its deadline | Stop automatic replay before `initial send time + replayWindowSeconds`. Check any known Operation ID and reconcile Resource/list evidence. If acceptance remains unknown, do not blindly resend with either the old or a new key. |

Keep Resource `generation`, `observedGeneration`, and `observedAt` distinct from Operation state. Operation success means the Form-defined management action completed; it is not a general application-health guarantee.

## When authentication changes {#auth-change}

The Host authenticates and authorizes each request. Follow its authentication documentation to learn whether credential rotation preserves the same stable principal and permissions. A different principal has a different Idempotency-Key scope; do not use a new principal's key to “retry” a request accepted under the old one.

If access was revoked, the Host may return `403` or `404` without revealing an existing Operation. Keep an uncertain intent rather than discarding or recreating it under another key. Restore authorized access to the original principal or agree on reconciliation with the user or Host operator.

## Return to the HTTP contract {#http-contract}

See the [HTTP retry contract](/spec/host-api/v2/http#retry) for matching and retention, and [Update](/spec/host-api/v2/http#update) plus [errors](/spec/host-api/v2/http#errors) for generation conflicts. The [illustrative examples](/spec/host-api/v2/examples) contain complete request/response values.
