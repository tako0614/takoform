---
title: Getting started with v2
description: Follow one fictional KeyValueEntry through Discovery, support, create, update, and delete.
---

# Getting started with v2 {#start}

Host API v2 separates the Form that defines a Resource's meaning, the Host that implements supported Forms, and the client that manages Resources. The HTTP walkthrough below uses the fictional Host `host.example` and Form URL `https://forms.publisher.example/key-value-entry/1.0.0`. It does not identify a reachable service or published Form. See the [full request/response transcript](/spec/host-api/v2/examples) for all fields and failure branches.

## 1. Discover the Host and check Form support {#discover-support}

A Form is a versioned specification URL published by its author; a Host is the service that implements it. The presence of a Form URL does not mean that a Host can execute it. First discover the Host's endpoint and authentication scheme, then ask that Host about the exact Form URL.

```http
GET /.well-known/takoform/v2 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json

{
  "api": "forms.takoform.com/v2",
  "baseUrl": "https://host.example/apis/forms.takoform.com/v2",
  "documentation": "https://host.example/docs",
  "authentication": {
    "schemes": ["Bearer"],
    "documentation": "https://host.example/docs/auth"
  },
  "capabilities": { "offerings": false, "previews": false, "privateInputs": false },
  "limits": { "maxRequestBytes": 1048576, "maxPageSize": 100, "replayWindowSeconds": 86400 }
}

GET /apis/forms.takoform.com/v2/support?form=https%3A%2F%2Fforms.publisher.example%2Fkey-value-entry%2F1.0.0 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "supported": true,
  "operations": ["create", "read", "update", "delete"],
  "privateInputs": false
}
```

Use Discovery's `baseUrl` and follow its authentication documentation. `support` reports this Host's technical support; it does not authorize the caller or reserve capacity.

## 2. Create, then read the Operation and Resource {#create-read}

The client chooses the Form URL, an authorized Space, name, a Form-conforming `spec`, and a fresh Idempotency-Key for each new operation. The Host issues the Resource UID and Operation ID.

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 946eec36-4a6a-41de-8f3c-e83d2c58c246

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default",
  "name": "greeting",
  "spec": { "key": "greeting", "value": "hello" }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_create_1
Retry-After: 1

{
  "id": "op_create_1", "resourceUid": "r_1", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:00:00Z", "updatedAt": "2026-10-04T12:00:00Z",
  "retainUntil": "2026-10-05T12:00:00Z"
}
```

`202 Accepted` means “accepted, not finished.” After `Retry-After`, read the Operation from `Location` or `op_create_1`. Once it succeeds, fetch the Resource.

```http
GET /apis/forms.takoform.com/v2/operations/op_create_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_create_1", "resourceUid": "r_1", "action": "create", "generation": 1,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:00:00Z", "updatedAt": "2026-10-04T12:00:01Z",
  "retainUntil": "2026-10-05T12:00:01Z"
}

GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "generation": 1, "observedGeneration": 1,
  "observedAt": "2026-10-04T12:00:01Z", "phase": "idle",
  "spec": { "key": "greeting", "value": "hello" },
  "observed": { "entryExists": true, "key": "greeting", "value": "hello" },
  "output": {}, "lastOperation": "op_create_1"
}
```

`spec` is the accepted desired value; `observed` is what the Host last checked. Matching `generation` and `observedGeneration` means this generation is observed in the example. Operation success or `phase: idle` alone does not establish application health.

## 3. Update the full spec with a generation condition {#update}

Update replaces the complete `spec` document; it is not a patch. Send the generation you read and use a new key because this is a new operation.

```http
PUT /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 3908a7cc-5083-439f-9966-b3db7e405859
Takoform-Expected-Generation: 1

{ "spec": { "key": "greeting", "value": "welcome" } }

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_update_1
Retry-After: 1

{
  "id": "op_update_1", "resourceUid": "r_1", "action": "update", "generation": 2,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:01:00Z", "updatedAt": "2026-10-04T12:01:00Z",
  "retainUntil": "2026-10-05T12:01:00Z"
}
```

Follow `op_update_1` to a terminal state and fetch Resource `r_1` again. In the successful example, both generations are 2 and the desired `spec.value` and observed `observed.value` are `welcome`. If the current generation is no longer 1, do not attach this stale request to the newer generation: reread the Resource and reconstruct the intended change.

## 4. Delete with generation 2 {#delete}

After confirming the current Resource generation, use that value for Delete. Deletion is also tracked by an Operation.

```http
DELETE /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Idempotency-Key: e1a20f10-0ac6-491d-b665-04de19f965f4
Takoform-Expected-Generation: 2

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_delete_1
Retry-After: 1

{
  "id": "op_delete_1", "resourceUid": "r_1", "action": "delete", "generation": 3,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:02:00Z", "updatedAt": "2026-10-04T12:02:00Z",
  "retainUntil": "2026-10-05T12:02:00Z"
}
```

Read `op_delete_1` and confirm success. A later Resource GET may return `410 Gone` if this Host retains a deletion marker or `404 Not Found` otherwise. Use the Operation as the evidence of the deletion result; do not infer backend effects from 404/410 alone. For the complete message shapes and recovery alternatives, see the [HTTP API](/spec/host-api/v2/http) and [full examples](/spec/host-api/v2/examples).

## Host implementers {#host-implementers}

An accepted Operation, its Idempotency-Key mapping, Resource UID and generation, and last verified observation must remain traceable across process restart. If a worker continues work after the HTTP handler returns, it must distinguish queued, running, and unknown outcomes on recovery. See the [Host implementation guide](/host-api/).
