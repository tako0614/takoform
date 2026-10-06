---
# Generated from spec/host-api/v2/examples.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/host-api/v2/examples.md
sourceLanguage: en
releaseState: revision-open
---

<div lang="en" class="specification-source">

# Host API v2 — request and response examples

This page is **non-normative**. It illustrates the [HTTP contract](/en/spec/host-api/v2/http) with hypothetical exchanges; it
is not a transcript from, or evidence of conformance by, a real Host. `host.example` and
`forms.publisher.example` are placeholder domains. The KeyValueEntry in [Form requirements](/en/spec/host-api/v2/forms) is
illustrative, not a published Form. Where an example uses a token placeholder, it is not an actual credential.

## One Resource from discovery through deletion

Assume a Host with Space `default`, no Offerings, previews, or private inputs, and a client authorized
under the Host’s Bearer scheme. The client chooses the exact Form URL, Space, name, `spec`, and a fresh key
for each *new* mutation. The Host issues Resource and Operation IDs, timestamps, and `Location`. The
repeated `Authorization` header below is illustrative; credentials are never part of the public Resource or
Operation.

### Discover the Host and check the Form

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
```

The values of the limits, including the 24-hour replay window, belong to this hypothetical Host. The client
appends `/support` and other suffixes to the discovered `baseUrl`; it does not send API requests to the
Form publisher’s domain.

```http
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

This confirms exact technical support, not authorization for this particular create, a capacity
reservation, or proof that the publisher’s URL was fetched by the Host.

### Create and observe completion

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

`202` means the mutation is accepted but unfinished. The client follows the Operation ID in the body or
`Location` after `Retry-After`. This example assumes the management action has settled by the next GET:

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
```

The client reads the Resource by `resourceUid`. Here the Host has verified generation 1; a different Form
could require an additional readiness check before its application is usable.

```http
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

`spec` is accepted desired input; `observed` and `output` are the last verified view. `phase:idle` is not a
general application-health signal.

### Replace the full spec

The client uses the *current* Resource generation and a new key. Because update replaces the full `spec`,
it includes the unchanged `key` as well as the new `value`.

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

The client follows the Operation rather than treating acceptance as success:

```http
GET /apis/forms.takoform.com/v2/operations/op_update_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_update_1", "resourceUid": "r_1", "action": "update", "generation": 2,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:01:00Z", "updatedAt": "2026-10-04T12:01:01Z",
  "retainUntil": "2026-10-05T12:01:01Z"
}
```

A fresh Resource read now shows the current desired and observed generation:

```http
GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "generation": 2, "observedGeneration": 2,
  "observedAt": "2026-10-04T12:01:01Z", "phase": "idle",
  "spec": { "key": "greeting", "value": "welcome" },
  "observed": { "entryExists": true, "key": "greeting", "value": "welcome" },
  "output": {}, "lastOperation": "op_update_1"
}
```

A stale `Takoform-Expected-Generation: 1` with a *new* key would be `409 generation_conflict`. The client
must read the Resource and reconsider intent, not silently replace the header with 2 and overwrite another
change.

### List, delete, and check the result

Resource listing is required, not an optional capability:

```http
GET /apis/forms.takoform.com/v2/resources?space=default HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "items": [
    {
      "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
      "space": "default", "name": "greeting",
      "generation": 2, "observedGeneration": 2,
      "observedAt": "2026-10-04T12:01:01Z", "phase": "idle",
      "spec": { "key": "greeting", "value": "welcome" },
      "observed": { "entryExists": true, "key": "greeting", "value": "welcome" },
      "output": {}, "lastOperation": "op_update_1"
    }
  ],
  "nextCursor": null
}
```

The client deletes only the addressed UID with generation 2 and another fresh key:

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

The name remains reserved while delete runs. The client first verifies that the Operation succeeded:

```http
GET /apis/forms.takoform.com/v2/operations/op_delete_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_delete_1", "resourceUid": "r_1", "action": "delete", "generation": 3,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:02:00Z", "updatedAt": "2026-10-04T12:02:01Z",
  "retainUntil": "2026-10-05T12:02:01Z"
}
```

This hypothetical Host retains a deletion marker and answers `410` for Resource read; another conforming
Host may use `404`. The error is not by itself proof of backend deletion—the successful Operation supplies
that evidence in this example.

```http
GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 410 Gone
Content-Type: application/problem+json
Cache-Control: no-store

{
  "type": "about:blank", "title": "Gone", "status": 410,
  "code": "gone", "detail": "This resource has been deleted."
}
```

The Operation remains available through its promised retention. Recreating the same name creates a
*different* UID; requests addressed to `r_1` cannot mutate the replacement.

## Unknown acknowledgement, replay, and a new intent

Suppose a create request is transmitted but its response is lost. The client does **not** know whether the
Host accepted it. Within the advertised replay window, it repeats the *identical* method, path, query,
body, private inputs (if any), and key. The following is an alternative to—not an additional mutation
after—the successful create above.

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 946eec36-4a6a-41de-8f3c-e83d2c58c246

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "spec": { "key": "greeting", "value": "hello" }
}

[No response received: acknowledgement is unknown]

POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 946eec36-4a6a-41de-8f3c-e83d2c58c246

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "spec": { "key": "greeting", "value": "hello" }
}

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_create_1

{
  "id": "op_create_1", "resourceUid": "r_1", "action": "create", "generation": 1,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:00:00Z", "updatedAt": "2026-10-04T12:00:01Z",
  "retainUntil": "2026-10-05T12:00:01Z"
}
```

A replay after completion returns the *original* Operation’s current state; one still in progress would
return `202` with `Retry-After`. Reusing that key with a changed `value`, path, or generation is
`409 idempotency_conflict`, not a new update. To express a genuinely new intent, the client first reads the
current Resource and then sends a **new key** and its actual current generation, as in the update above. A
new key is never a repair for an unknown original acknowledgement.

After the advertised replay window, the Host may no longer detect the old key. The client stops automatic
replay before the window ends, then consults any known Operation ID and Resource evidence—for example
`GET {root}/resources?space=default&name=greeting`. An empty list alone does not prove that an accepted
backend mutation never happened. The client does not blindly resubmit with the old or a new key.

## Unknown backend result, proven partial effect, and same-UID cleanup

This is an **alternative** continuation after KeyValueEntry `r_1` has confirmed generation 2 with value
`welcome`, but before its happy-path deletion. It uses the independent fictional
[RenderedGreeting Form](/en/spec/host-api/v2/forms#rendered-greeting). Its unsigned
mode needs no private input. A hypothetical Host that fully implements this mode but not signing can
report the exact Form supported with `privateInputs:false`:

```http
GET /apis/forms.takoform.com/v2/support?form=https%3A%2F%2Fforms.publisher.example%2Frendered-greeting%2F1.0.0 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "form": "https://forms.publisher.example/rendered-greeting/1.0.0",
  "supported": true,
  "operations": ["create", "read", "update", "delete"],
  "privateInputs": false
}
```

The client creates a RenderedGreeting that refers to `r_1` by UID. The Host must check that `r_1` has
the exact KeyValueEntry Form, same owner and Space, authorization, and a confirmed source observation.
Here that observation is `observedGeneration:2`, `entryExists:true`, and `value:"welcome"`. The
dependent does not infer a source value from the source's unobserved desired spec.

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 6f0bfaa2-1133-4d35-b85f-740797bfa0ed

{
  "form": "https://forms.publisher.example/rendered-greeting/1.0.0",
  "space": "default", "name": "rendered-greeting",
  "spec": {
    "source": { "resourceUid": "r_1" },
    "prefix": "Hello ",
    "signed": false
  }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_rg_create_1
Retry-After: 1

{
  "id": "op_rg_create_1", "resourceUid": "rg_1", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:02:00Z", "updatedAt": "2026-10-04T12:02:00Z",
  "retainUntil": "2026-10-05T12:02:00Z"
}
```

A successful Operation means the snapshot bytes were durably held and read back exactly. The digest below
is SHA-256 of the UTF-8 bytes of `Hello welcome`, not an invented readiness signal.

```http
GET /apis/forms.takoform.com/v2/operations/op_rg_create_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_rg_create_1", "resourceUid": "rg_1", "action": "create", "generation": 1,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:02:00Z", "updatedAt": "2026-10-04T12:02:01Z",
  "retainUntil": "2026-10-05T12:02:01Z"
}

GET /apis/forms.takoform.com/v2/resources/rg_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "rg_1", "form": "https://forms.publisher.example/rendered-greeting/1.0.0",
  "space": "default", "name": "rendered-greeting",
  "generation": 1, "observedGeneration": 1,
  "observedAt": "2026-10-04T12:02:01Z", "phase": "idle",
  "spec": {
    "source": { "resourceUid": "r_1" },
    "prefix": "Hello ",
    "signed": false
  },
  "observed": {
    "ready": true, "sourceGeneration": 2, "snapshotGeneration": 1,
    "snapshotSha256": "41ae0a89ea376f692a9a2525c4be6b4d10ea296fc165fdc8e1cc1f33bff7e50d"
  },
  "output": { "text": "Hello welcome" },
  "lastOperation": "op_rg_create_1"
}
```

The client then requests a new `prefix`. `source` and `signed` remain unchanged in this full-spec
replacement. Generation 2 has a distinct UID-and-generation-derived snapshot identity:

```http
PUT /apis/forms.takoform.com/v2/resources/rg_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 96278ddc-e24c-4872-bc1f-6992b6810827
Takoform-Expected-Generation: 1

{
  "spec": {
    "source": { "resourceUid": "r_1" },
    "prefix": "Hi ",
    "signed": false
  }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_rg_update_1
Retry-After: 1

{
  "id": "op_rg_update_1", "resourceUid": "rg_1", "action": "update", "generation": 2,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:03:00Z", "updatedAt": "2026-10-04T12:03:00Z",
  "retainUntil": "2026-10-05T12:03:00Z"
}
```

A lost backend response after possible dispatch is not proof of no effect. The Host uses the **same**
Operation and snapshot identity for readback, reporting an unknown result while it cannot decide:

```http
GET /apis/forms.takoform.com/v2/operations/op_rg_update_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_rg_update_1", "resourceUid": "rg_1", "action": "update", "generation": 2,
  "status": "reconciling", "effect": "unknown",
  "createdAt": "2026-10-04T12:03:00Z", "updatedAt": "2026-10-04T12:03:05Z",
  "retainUntil": "2026-10-05T12:03:00Z"
}
```

While unresolved, a different mutation on `rg_1` is `409 resource_busy`. In this branch of the example,
the backend first fences that exact generation and Operation, excluding a delayed writer. Readback then
proves that the generation-2 snapshot exists but has incomplete bytes. Only with that proof can the Host
settle the same Operation as a known partial failure with the Form-defined `snapshot_incomplete` code.
If fencing or readback cannot establish this, it must stay `reconciling/effect:unknown`:

```http
GET /apis/forms.takoform.com/v2/operations/op_rg_update_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_rg_update_1", "resourceUid": "rg_1", "action": "update", "generation": 2,
  "status": "failed", "effect": "partial",
  "createdAt": "2026-10-04T12:03:00Z", "updatedAt": "2026-10-04T12:04:00Z",
  "retainUntil": "2026-10-05T12:04:00Z",
  "error": { "code": "snapshot_incomplete", "message": "The generation-2 snapshot is incomplete." }
}
```

The Resource retains the last *confirmed* snapshot observation and output. It does not display incomplete
`Hi welcome` bytes as ready, or advance `observedGeneration` to 2:

```http
GET /apis/forms.takoform.com/v2/resources/rg_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "rg_1", "form": "https://forms.publisher.example/rendered-greeting/1.0.0",
  "space": "default", "name": "rendered-greeting",
  "generation": 2, "observedGeneration": 1,
  "observedAt": "2026-10-04T12:02:01Z", "phase": "error",
  "spec": {
    "source": { "resourceUid": "r_1" },
    "prefix": "Hi ",
    "signed": false
  },
  "observed": {
    "ready": true, "sourceGeneration": 2, "snapshotGeneration": 1,
    "snapshotSha256": "41ae0a89ea376f692a9a2525c4be6b4d10ea296fc165fdc8e1cc1f33bff7e50d"
  },
  "output": { "text": "Hello welcome" },
  "lastOperation": "op_rg_update_1"
}
```

The Form defines a same-UID delete as cleanup of known partial snapshots. With generation 2 and a new
key, the client deletes RenderedGreeting `rg_1`, **not** its source KeyValueEntry `r_1`:

```http
DELETE /apis/forms.takoform.com/v2/resources/rg_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Idempotency-Key: c49d3bbc-209d-444b-9cdd-195d6d64ea48
Takoform-Expected-Generation: 2

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_rg_cleanup_1
Retry-After: 1

{
  "id": "op_rg_cleanup_1", "resourceUid": "rg_1", "action": "delete", "generation": 3,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:05:00Z", "updatedAt": "2026-10-04T12:05:00Z",
  "retainUntil": "2026-10-05T12:05:00Z"
}

GET /apis/forms.takoform.com/v2/operations/op_rg_cleanup_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_rg_cleanup_1", "resourceUid": "rg_1", "action": "delete", "generation": 3,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:05:00Z", "updatedAt": "2026-10-04T12:05:02Z",
  "retainUntil": "2026-10-05T12:05:02Z"
}
```

The Host confirms removal of `rg_1`’s generation-1 and partial generation-2 snapshots and any signing
material before reporting success. The source `r_1` remains independently managed; its reference is
released only after the dependent Resource is no longer live.
## Two-page listing and cursor expiry

This independent example uses `limit=1` on two authorized Resources, sorted by UID. The cursor string is
opaque and only illustrative.

```http
GET /apis/forms.takoform.com/v2/resources?space=default&limit=1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "items": [
    {
      "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
      "space": "default", "name": "first",
      "generation": 1, "observedGeneration": 0, "observedAt": null, "phase": "pending",
      "spec": { "key": "first", "value": "one" }, "observed": {}, "output": {},
      "lastOperation": "op_first"
    }
  ],
  "nextCursor": "cursor-after-r_1"
}

GET /apis/forms.takoform.com/v2/resources?space=default&limit=1&cursor=cursor-after-r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "items": [
    {
      "uid": "r_2", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
      "space": "default", "name": "second",
      "generation": 1, "observedGeneration": 0, "observedAt": null, "phase": "pending",
      "spec": { "key": "second", "value": "two" }, "observed": {}, "output": {},
      "lastOperation": "op_second"
    }
  ],
  "nextCursor": null
}
```

The client keeps the same filters, Space, principal, and authorization. If the cursor expires before the
second request, the *alternative* response is:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
Cache-Control: no-store

{
  "type": "about:blank", "title": "Cursor expired", "status": 409,
  "code": "cursor_expired"
}
```

The client then restarts at page one. This walk is not a snapshot under concurrent creates and deletes.

## Optional capabilities are separate choices

These are independent hypothetical Host configurations, not a claim that the minimal Host above enables
them. Check Discovery before using each route or field.

### Offering selection

Assume `offerings:true`. The Host requires Form and Space and returns an authorized,
[paginated](/en/spec/host-api/v2/http#pagination) list:

```http
GET /apis/forms.takoform.com/v2/offerings?form=https%3A%2F%2Fforms.publisher.example%2Fkey-value-entry%2F1.0.0&space=default HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "items": [{
    "id": "standard", "revision": "rev-7",
    "form": "https://forms.publisher.example/key-value-entry/1.0.0",
    "label": "Standard", "description": "Standard capacity",
    "termsUrl": "https://host.example/terms/standard"
  }],
  "nextCursor": null
}
```

The client includes the exact selected `id` and `revision` in its new create body; `offering_changed`
requires renewed user choice, not a silent selection.

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 2b908375-c0f2-4f9e-8cf5-0522bf8a45ad

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "offered-greeting",
  "offering": { "id": "standard", "revision": "rev-7" },
  "spec": { "key": "offered-greeting", "value": "hello" }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_create_2
Retry-After: 1

{
  "id": "op_create_2", "resourceUid": "r_3", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T13:00:00Z", "updatedAt": "2026-10-04T13:00:00Z",
  "retainUntil": "2026-10-05T13:00:00Z"
}
```

### Preview

Assume `previews:true`. Preview checks a candidate but does not create a Resource, reservation, charge,
Operation, or stored secret. The real mutation rechecks everything.

```http
POST /apis/forms.takoform.com/v2/previews HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json

{
  "action": "create",
  "input": {
    "form": "https://forms.publisher.example/key-value-entry/1.0.0",
    "space": "default", "name": "preview-greeting",
    "spec": { "key": "preview-greeting", "value": "hello" }
  }
}

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{ "valid": true, "errors": [] }
```

### Private-input replenishment

Assume `privateInputs:true` in Discovery *and* Support for a separate Form defining `apiToken`. The
placeholder below stands for the *same* confidential string in both requests; do not put a real secret in
documentation or ordinary public state. If either capability flag were false, even `"privateInputs": {}`
would receive `422 capability_required`.

```http
GET /apis/forms.takoform.com/v2/support?form=https%3A%2F%2Fforms.publisher.example%2Fsecret-service%2F1.0.0 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "form": "https://forms.publisher.example/secret-service/1.0.0",
  "supported": true,
  "operations": ["create", "read", "update", "delete"],
  "privateInputs": true
}
```

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 8e74a095-74b6-46bf-9e58-921ab0c74d6c

{
  "form": "https://forms.publisher.example/secret-service/1.0.0",
  "space": "default", "name": "private-service",
  "spec": { "endpoint": "https://service.example" },
  "privateInputs": { "apiToken": "<same-secret-value>" }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_secret_1
Retry-After: 1

{
  "id": "op_secret_1", "resourceUid": "r_secret_1", "action": "create", "generation": 1,
  "status": "waiting_input", "effect": "none",
  "createdAt": "2026-10-04T14:00:00Z", "updatedAt": "2026-10-04T14:01:00Z",
  "retainUntil": "2026-10-05T14:01:00Z",
  "inputRequired": { "names": ["apiToken"], "reason": "expired" }
}
```

Here the Host proved the affected step unsent before entering `waiting_input`. The client resupplies the
**entire original map**, without a new idempotency key or generation:

```http
PUT /apis/forms.takoform.com/v2/operations/op_secret_1/private-inputs HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json

{ "privateInputs": { "apiToken": "<same-secret-value>" } }

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_secret_1", "resourceUid": "r_secret_1", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T14:00:00Z", "updatedAt": "2026-10-04T14:02:00Z",
  "retainUntil": "2026-10-05T14:02:00Z"
}
```

A different secret yields `409 private_inputs_conflict`; an unverifiable original yields
`409 private_inputs_unverifiable`. If the backend might already have received the step, the Host reconciles
it instead of entering `waiting_input`.


</div>
