---
title: Create a Form
prev:
  text: The v2 model
  link: /model/
next:
  text: Form requirements
  link: /spec/host-api/v2/forms
---

# Create a Form {#authoring}

A Takoform v2 Form defines the settings and behavior for one kind of Host-managed Resource. Start by stating what the Resource owns; then make its inputs, observations, operations, and failure recovery precise. A Host does not fetch code from a published Form URL. It explicitly implements the Forms it supports.

This guide walks through designing, publishing, and checking a fictional `KeyValueEntry` Form. It is a teaching example, not a claim that the Form is published or supported by any Host.

## 1. Define the Resource and its boundary {#purpose}

The example Resource is “one named string entry in a Space.” It owns that entry, not the entire collection or other entries. The [Host API v2](/spec/host-api/v2/http) defines common HTTP behavior; the [Form specification](/spec/host-api/v2/forms) defines the meaning specific to this Resource.

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

This example has no references, Interfaces, Bindings, artifacts, or private inputs. If you add JSON Schema or another machine-readable aid, test that it agrees with the normative text. See [Form requirements](/spec/host-api/v2/forms#what-a-form-specification-must-define) and the [author checklist](/spec/host-api/v2/forms#author-checklist) for the full contract.

## 5. Publish the Form at its exact URL {#publish}

Before publishing, confirm that the specification answers every question in the [author checklist](/spec/host-api/v2/forms#author-checklist).

Then serve the human-readable normative specification at the Form URL. That is all [publication](/spec/host-api/v2/#compatibility) requires: no package, signature, or registration. Following the [URL rules](/spec/host-api/v2/forms#publication), the URL must be an ASCII absolute HTTPS URL, with non-ASCII characters percent-encoded and no user information, query, or fragment. Its full string is the Form's identity, and Hosts and clients do not follow redirects, change case, or add a trailing slash to match it, so check that the exact string you publish serves the page. [Step 1](#purpose) covers version-shaped paths and new URLs for changed contracts.

Keep the contract at that URL fixed. Layout, navigation, and explanations may improve there, but a change in normative behavior needs a new URL and must not be presented as an editorial clarification. Machine-readable aids such as JSON Schema stay supplemental unless the specification makes one normative, and implementers may keep copies of the page to compare revisions.

Publishing registers the Form nowhere, and takoform.com keeps no Form catalog. A Host must not fetch or execute a Form URL it receives in a request to learn the contract: a Host operator implements a Form explicitly and then reports it through `support`. Give the exact URL to the Host operators you want to implement it and to the clients who will request it. A Host must not depend on your site to manage or recover existing Resources, but keep the page served, because implementers and clients read it. For a complete specification to model yours on, see the [KeyValueEntry Form](/spec/host-api/v2/forms#key-value-entry).

## 6. Check a Host's support and try the API {#check}

Once a Host operator has implemented your Form, check it the way a client will. Ask the Host operator for the API root (the `baseUrl` from its [Discovery](/start/#discover-support)), Space, and authentication method, and set them and your Form's URL below. The example values are fictional.

```sh
export BASE_URL='https://host.example/apis/forms.takoform.com/v2'
export FORM_URL='https://forms.publisher.example/key-value-entry/1.0.0'
export SPACE='development'
export TOKEN='replace-with-a-short-lived-token'

curl --fail-with-body -G "$BASE_URL/support" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "form=$FORM_URL"
```

Check that `form` exactly equals the URL you sent and inspect `supported` and the required operations. `supported: true` declares implementation; it does not promise your authorization, capacity, or success for an individual Operation. If unsupported, do not create a Resource; ask the Host operator.

On a Host that supports the Form, create a Resource. First generate a new `Idempotency-Key` for this create. If `uuidgen` is not installed, `openssl rand -hex 16` also gives a valid key.

```sh
CREATE_KEY=$(uuidgen)
```

Then send the create. The body uses the Form URL and Space set above. If the Host's Discovery has `capabilities.offerings: true`, the body also needs an [`offering`](/spec/host-api/v2/http#offerings).

```sh
curl --fail-with-body -i -X POST "$BASE_URL/resources" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $CREATE_KEY" \
  --data @- <<JSON
{"form": "$FORM_URL", "space": "$SPACE", "name": "welcome-entry",
 "spec": {"key": "welcome", "value": "Hello, Ada!"}}
JSON
```

If the response is lost, run only this `curl` command again, within the Host's replay window (Discovery's `replayWindowSeconds`). The same key and body return the original Operation. A new key would be a second create, which the Host rejects with `409 name_conflict` because the name is taken.

The response body is the Operation, and its `Location` header is the Operation's URL. `202` means the Operation has not finished yet, and its `Retry-After` header says how many seconds to wait before reading it again; `200` means it has already settled. Read the Operation until its `status` is `succeeded` or `failed`, then read the Resource by the Operation's `resourceUid`:

```sh
OPERATION_URL='replace-with-the-Location-header'
RESOURCE_UID='replace-with-the-resourceUid'

curl --fail-with-body "$OPERATION_URL" \
  -H "Authorization: Bearer $TOKEN"

curl --fail-with-body "$BASE_URL/resources/$RESOURCE_UID" \
  -H "Authorization: Bearer $TOKEN"
```

After `succeeded`, check that `spec` is what you sent and that `observed` follows your Form's shapes. If the Operation `failed`, its `error` says why and `effect` says whether anything changed. The Resource stays in `phase: error`, keeping its name, until you update or delete it. This example Form's update never recreates a missing entry, so after a failed create you usually delete the Resource. If the Operation stays `reconciling`, the Host has not yet established the result; ask the Host operator rather than creating again.

For update, send the complete `spec` with the current generation in `Takoform-Expected-Generation`, keeping `spec.key` and replacing only `spec.value`. Delete takes the same header and no body. Give each update and delete its own new `Idempotency-Key`, and wait for its Operation to finish. The [HTTP API's create/read/update/delete sections](/spec/host-api/v2/http#create) define the exact headers and responses.

## Continue

- [Normative Form specification](/spec/host-api/v2/forms)
- [Common Host API v2 format and operations](/spec/host-api/v2/http)
- [Form author checklist](/spec/host-api/v2/forms#author-checklist)
