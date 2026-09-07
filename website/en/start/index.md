---
title: Getting started
---

# Getting started {#はじめる}

Verify a fixture package and build a Snapshot, then read Host API request/response
examples. This guide is non-normative. These are fictional Form fixtures:
the commands do not connect to a Host or create resources.

## 0. Prepare {#_0-準備}

Work at the Takoform repository root. Fetch Go dependencies first. Once they are
available, the verification commands below can run without network access.

```console
go mod download
```

This preparation may need network access. Bun and a Host connection are not required.

## 1. Verify a package {#_1-パッケージを検証する}

A Form Package contains one FormRef, its definition and declared files. This
command checks required files, content digests and FormRef consistency, then
prints a JSON result to standard output.

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

Output excerpt:

```json
{
  "packageDigest": "sha256:3af4d09e2939b533a800fba945a85fb7a168ca8fae3454727a028505e38981d7",
  "formRef": {
    "apiVersion": "resources.publisher.example",
    "kind": "CounterReservation",
    "definitionVersion": "0.1.0",
    "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
  },
  "fileCount": 1,
  "payloadBytes": 1689
}
```

`packageDigest` identifies the canonical package index; `schemaDigest` identifies
the canonical definition. The namespace and kind are test-only. Successful
verification does not prove publication or availability on a Host.

## 2. Build and verify a Snapshot {#_2-snapshotを作成して検証する}

The next command verifies the packages, Interfaces and Bindings named in the
manifest, then constructs an immutable Snapshot independently of input order.

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

Report excerpt:

```json
{
  "format": "takoform.generic-conformance-report@v1",
  "status": "passed",
  "hostApiLane": "forms.takoform.com/v1",
  "manifestDigest": "sha256:7caed449cd40068c0ac940a20e6c5d1fe8555ce4a16812416ea5962d2a243e38",
  "snapshots": [
    { "name": "external-family", "snapshotDigest": "sha256:54f0d997aa1660b07a70dd694713bdd322a9e51774020f70f3d980c8800c360c" },
    { "name": "zero-family", "snapshotDigest": "sha256:591e5ca6da361ba9dc3ca8f091a601ae90ae3cc362b959e37ee23a634a2b2e50" }
  ],
  "checks": [
    { "name": "snapshot-compilation", "status": "passed" },
    { "name": "permutation-stable", "status": "passed" },
    { "name": "no-partial-snapshot", "status": "passed" }
  ]
}
```

`snapshot-compilation` checks references and digests. `permutation-stable` checks
that input order does not change the result. `no-partial-snapshot` checks that
failure does not return an incomplete Snapshot. `zero-family` checks that no
particular Form Family is built in. These checks do not access the network,
perform Host operations, change resources or start executable code.

## 3. Read Host API examples {#_3-host-apiの要求・応答例を読む}

The following [Host API v1](/en/spec/host-api/v1) exchanges illustrate the wire
format. They are not commands to execute and use fictional endpoints and responses.

First obtain connection information. `api_versions` lists the supported API
version and `endpoints.api` gives the API endpoint.

```http
GET /.well-known/takoform/v1

HTTP/1.1 200 OK
Content-Type: application/json

{
  "api_versions": ["forms.takoform.com/v1"],
  "features": {
    "service_forms": true,
    "exact_form_ref": true,
    "optimistic_concurrency": true,
    "idempotent_lifecycle": true,
    "operations": true,
    "artifact_upload": true,
    "support_profiles": true
  },
  "endpoints": {
    "api": "https://host.example/apis/forms.takoform.com/v1"
  }
}
```

`https://host.example` is illustrative. Use the returned API endpoint as-is,
then add the Form Family namespace, kind and resource name to construct the
operation URL. The Form Family namespace does not include a version.

This example assumes the referenced `RangeSequence` already exists in the same space and the caller may create the reservation. First check support and admission for the exact FormRef.

```http
GET https://host.example/apis/forms.takoform.com/v1/forms?group=resources.publisher.example&kind=CounterReservation&definitionVersion=0.1.0&schemaDigest=sha256%3A9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116&space=demo

HTTP/1.1 200 OK
Content-Type: application/json

{
  "forms": [
    {
      "identity": {
        "formRef": {
          "apiVersion": "resources.publisher.example",
          "kind": "CounterReservation",
          "definitionVersion": "0.1.0",
          "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
        }
      },
      "definitionKnown": true,
      "installed": true,
      "executable": true,
      "activated": true,
      "availableToPrincipal": true,
      "operations": [
        "create",
        "read",
        "delete",
        "import",
        "observe"
      ]
    }
  ]
}
```

Next, send the desired resource to `prepare`. The Host checks it and returns the same resource content with a `review`. Preparation does not create the resource.

```http
POST https://host.example/apis/forms.takoform.com/v1/resources/prepare
Content-Type: application/json

{
  "apiVersion": "resources.publisher.example",
  "kind": "CounterReservation",
  "form": {
    "formRef": {
      "apiVersion": "resources.publisher.example",
      "kind": "CounterReservation",
      "definitionVersion": "0.1.0",
      "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
    }
  },
  "metadata": {
    "name": "counter-reservation",
    "space": "demo"
  },
  "spec": {
    "target": {
      "apiVersion": "resources.publisher.example",
      "kind": "RangeSequence",
      "name": "range-sequence"
    }
  }
}

HTTP/1.1 200 OK
Content-Type: application/json

{
  "resource": {
    "apiVersion": "resources.publisher.example",
    "kind": "CounterReservation",
    "form": {
      "formRef": {
        "apiVersion": "resources.publisher.example",
        "kind": "CounterReservation",
        "definitionVersion": "0.1.0",
        "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
      }
    },
    "metadata": {
      "name": "counter-reservation",
      "space": "demo"
    },
    "spec": {
      "target": {
        "apiVersion": "resources.publisher.example",
        "kind": "RangeSequence",
        "name": "range-sequence"
      }
    }
  },
  "review": {
    "prepareDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "specDigest": "sha256:2bf6bf2dbd6249a80082f45aebf696ebcf93c52a457a4a9234f18a29ed219e25"
  }
}
```

Pass the returned `review.prepareDigest` to apply without changing the resource. The repeated `a` value below is illustrative: use the real Host response, never a client-generated value. `If-None-Match: *` prevents creation from overwriting an existing resource. Synchronous completion returns the full created Resource.

```http
PUT https://host.example/apis/forms.takoform.com/v1/resources/resources.publisher.example/CounterReservation/counter-reservation
If-None-Match: *
Idempotency-Key: create-counter-reservation-20260907
Content-Type: application/json

{
  "apiVersion": "resources.publisher.example",
  "kind": "CounterReservation",
  "form": {
    "formRef": {
      "apiVersion": "resources.publisher.example",
      "kind": "CounterReservation",
      "definitionVersion": "0.1.0",
      "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
    }
  },
  "metadata": {
    "name": "counter-reservation",
    "space": "demo"
  },
  "spec": {
    "target": {
      "apiVersion": "resources.publisher.example",
      "kind": "RangeSequence",
      "name": "range-sequence"
    }
  },
  "review": {
    "prepareDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}

HTTP/1.1 201 Created
Content-Type: application/json
ETag: "1"

{
  "apiVersion": "resources.publisher.example",
  "kind": "CounterReservation",
  "form": {
    "formRef": {
      "apiVersion": "resources.publisher.example",
      "kind": "CounterReservation",
      "definitionVersion": "0.1.0",
      "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
    }
  },
  "metadata": {
    "name": "counter-reservation",
    "space": "demo",
    "uid": "res_counter_reservation_1",
    "generation": "1",
    "revision": "1"
  },
  "spec": {
    "target": {
      "apiVersion": "resources.publisher.example",
      "kind": "RangeSequence",
      "name": "range-sequence"
    }
  },
  "status": {
    "observedGeneration": "1",
    "conditions": [
      {
        "type": "Ready",
        "status": "True",
        "reason": "Available",
        "lastTransitionTime": "2026-09-07T00:00:00Z"
      }
    ]
  }
}
```

For asynchronous work, the Host returns the following `202 Accepted` instead of the `201 Created` above. These are alternative outcomes, not consecutive responses.

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "operation": {
    "apiVersion": "operations.takoform.com/v1alpha1",
    "kind": "Operation",
    "id": "op_counter_reservation_create",
    "done": false
  }
}
```

Retrieve the result using the returned Operation ID. While `done` is false, follow the Host retry guidance; after completion, inspect the resulting Resource or error. The response below shows successful completion.

```http
GET https://host.example/apis/forms.takoform.com/v1/operations/op_counter_reservation_create

HTTP/1.1 200 OK
Content-Type: application/json

{
  "apiVersion": "operations.takoform.com/v1alpha1",
  "kind": "Operation",
  "id": "op_counter_reservation_create",
  "done": true,
  "result": {
    "resource": {
      "apiVersion": "resources.publisher.example",
      "kind": "CounterReservation",
      "form": {
        "formRef": {
          "apiVersion": "resources.publisher.example",
          "kind": "CounterReservation",
          "definitionVersion": "0.1.0",
          "schemaDigest": "sha256:9981fb7988d13844b8e22ab2428407aa90e7e368df876086e0e456151ff61116"
        }
      },
      "metadata": {
        "name": "counter-reservation",
        "space": "demo",
        "uid": "res_counter_reservation_1",
        "generation": "1",
        "revision": "1"
      },
      "spec": {
        "target": {
          "apiVersion": "resources.publisher.example",
          "kind": "RangeSequence",
          "name": "range-sequence"
        }
      },
      "status": {
        "observedGeneration": "1",
        "conditions": [
          {
            "type": "Ready",
            "status": "True",
            "reason": "Available",
            "lastTransitionTime": "2026-09-07T00:00:00Z"
          }
        ]
      }
    }
  }
}
```

Updates use the retrieved UID and generation to guard against concurrent changes. This particular `CounterReservation` definition does not support updates: check the definition and Host availability before choosing an operation. For an executable call sequence in Go, see [Use a Host from Go](/en/client/).

For fields, statuses, concurrency checks and errors, read the
[Host API v1 specification](/en/spec/host-api/v1) and its
[operation overview](/en/spec/host-api/v1#artifacts-and-operations).

## Next steps {#次に進む}

- [Implementation guides](/en/guides/) — relevant specifications for your implementation.
- [Common model](/en/model/) — identities, packages and Snapshots.
- [Host API overview](/en/host-api/) — discovery and main operations.
- [Reference](/en/reference/) — specifications and explanatory guides.
