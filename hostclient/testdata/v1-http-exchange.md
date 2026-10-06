# Retained Host API v1 HTTP exchange

This is an informative fixture for the retained v1 client and schema tests, not
a v2 guide or a running Host. The six HTTP blocks below are preserved byte-for-byte
from `website/start/index.md` at commit
`3d614c5bb247bc78a173d6cc953a3e0f3249e6e2`, before that reader entry became v2-first.
They do not change the frozen v1 contract.

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

