---
title: Create a Form
---

# Create a Form {#authoring}

A Takoform v2 Form defines the settings and behavior for one kind of Host-managed Resource. Start by stating what the Resource owns; then make its inputs, observations, operations, and failure recovery precise. A Host does not fetch code from a published Form URL. It explicitly implements the Forms it supports.

This guide walks through designing and checking a fictional `KeyValueEntry` Form. It is a teaching example, not a claim that the Form is published or supported by any Host.

## 1. Define the Resource and its boundary {#purpose}

The example Resource is “one named string entry in a Space.” It owns that entry, not the entire collection or other entries. The [Host API v2](/en/spec/host-api/v2/http) defines common HTTP behavior; the [Form specification](/en/spec/host-api/v2/forms) defines the meaning specific to this Resource.

The example uses this fictional exact Form URL:

```text
https://forms.publisher.example/key-value-entry/1.0.0
```

Forms are identified by exact URL string. Do not silently change the contract at an existing URL; use a new URL for a semantic change. A SemVer-shaped path is an authoring convention, not a Host API version or an automatic compatibility rule.

## 2. Separate desired input from observation {#definition}

`spec` is desired state, `observed` is what the Host has confirmed, and `output` contains values needed to use the Resource. Keep the three separate. In particular, do not turn an unknown result into “absent” or “ready.”

This example's `spec` has exactly two fields. Unknown fields and `null` are rejected; neither field has an implicit default.

| Field | Meaning | Create | Update |
| --- | --- | --- | --- |
| `key` | Unique within the same Host, Space, and Form URL. 1–128 Unicode scalar values; case-sensitive. | Required | Immutable |
| `value` | Stored string, 0–4096 Unicode scalar values. Empty string is valid. | Required | Replaceable |

```json
{
  "key": "welcome",
  "value": "Hello, Ada!"
}
```

Lengths count Unicode scalar values, not UTF-8 bytes. Before the first confirmed observation, use `observed: {}`. Confirmed presence is `{ "entryExists": true, "key": "welcome", "value": "Hello, Ada!" }`; confirmed absence is `{ "entryExists": false }`. If the Host cannot check, it must not claim absence. `output` is always `{}`. This Form does not claim that an application is running.

## 3. Define operations and recovery {#lifecycle}

Define what create, read, update, and delete mean for this Form. Use common API rules for HTTP statuses, generations, `Idempotency-Key`, and Operation shape rather than redefining them in each Form.

- **Create:** Create one entry scoped by `(Host, Space, Form URL, key)`. If the key is already in use, fail with `key_conflict` and leave its existing value unchanged.
- **Read:** Return the Resource and its last confirmed state. This Form does not require a new backend lookup for every GET.
- **Update:** Replace only `value`. Reject a changed `key` before external effects. Updating a missing entry does not recreate it.
- **Delete:** Remove only the entry this Resource represents. If it is confirmed absent, deletion is complete. Do not delete the collection or another entry.

If the response is lost after a write may have happened, a timeout does not prove that nothing happened. Keep the same Resource and Operation, read back the same key, and compare its value. If the result cannot be proved, retain the Operation as unresolved. Before adding more examples, decide and test how the Form handles partial success, failure, and unknown outcomes.

## 4. Write and test the Form specification {#write}

Turn the table above into a human-readable normative specification. A reader should be able to find all of these answers without guessing:

1. The Resource's purpose and what it does not own.
2. Every `spec` field's type, requiredness, omission behavior, limits, unknown-field rule, and mutability.
3. The meaning of `observed`, `output`, unobserved or stale values, and any readiness claim.
4. Create/read/update/delete effects, failures, partial effects, same-UID recovery, and deletion scope.
5. Exact identities, owners, and constraints for any Resource references, Interfaces, Bindings, or artifacts. Say “none” when not applicable.
6. For private inputs: their names, values, and when they are required; whether they are optional or intrinsic to every valid use; and how they stay out of public Resources and logs.

This example has no references, Interfaces, Bindings, artifacts, or private inputs. If you add JSON Schema or another machine-readable aid, test that it agrees with the normative text. See [Form requirements](/en/spec/host-api/v2/forms#what-a-form-specification-must-define) and the [author checklist](/en/spec/host-api/v2/forms#author-checklist) for the full contract.

## 5. Check a Host's support and try the API {#check}

Ask the Host operator for the API root, Space, and authentication method. The following shell example assumes those values are set. Since the Form URL is fictional, a real Host may not support it.

```sh
export BASE_URL='https://host.example.test/api-root-returned-by-discovery'
export FORM_URL='https://forms.publisher.example/key-value-entry/1.0.0'
export SPACE='development'
export TOKEN='replace-with-a-short-lived-token'

curl --fail-with-body -G "$BASE_URL/support" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "form=$FORM_URL"
```

Check that `form` exactly equals the URL you sent and inspect `supported` and the required operations. `supported: true` declares implementation; it does not promise your authorization, capacity, or success for an individual Operation. If unsupported, do not create a Resource; ask the Host operator.

On a Host that supports the Form, use a fresh `Idempotency-Key` for create. A `200` response contains a terminal Operation; for `202`, poll the Operation at `Location`. Wait for a terminal result before reading the Resource.

```sh
curl --fail-with-body -X POST "$BASE_URL/resources" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: tutorial-create-001' \
  --data '{"form":"https://forms.publisher.example/key-value-entry/1.0.0","space":"development","name":"welcome-entry","spec":{"key":"welcome","value":"Hello, Ada!"}}'
```

GET the Operation at its `Location`. After terminal success, GET the Resource by its returned UID. For update, send the complete `spec` with the current generation and the same `key`, replacing only `value`. For delete, send the current generation and a new idempotency key, then wait for that Operation to complete. The [HTTP API's create/read/update/delete sections](/en/spec/host-api/v2/http#create) define the exact headers and responses.

## Continue

- [Normative Form specification](/en/spec/host-api/v2/forms)
- [Common Host API v2 format and operations](/en/spec/host-api/v2/http)
- [Form author checklist](/en/spec/host-api/v2/forms#author-checklist)
