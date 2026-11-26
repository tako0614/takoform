---
title: Using v2
description: What you need to manage Resources through Host API v2, how to check a Host, and which client to use in your situation.
prev:
  text: Getting started
  link: /start/
next:
  text: Request/response examples
  link: /spec/host-api/v2/examples
---

# Using v2 {#use}

To manage a Resource through Host API v2 you need three things: a Host operator who gives you the Host's origin, credentials, and a Space you may use; the exact Form URL for the kind of Resource you want; and a client that speaks v2 with that Host's authentication. Check them in that order. Takoform itself runs no Host, and no API call lists the Forms a Host supports: [Discovery](/glossary#discovery) carries only connection metadata, `support` answers only about a URL you already have, and takoform.com keeps no Form catalog. Get the Form URL from the Form's author, who publishes its specification there, or ask the Host operator which exact Form URLs the Host implements.

## 1. Check what the Host offers {#host}

Read the Host's Discovery document at `/.well-known/takoform/v2` for its API root (`baseUrl`), authentication, and `replayWindowSeconds`, then ask its `support` endpoint about the exact Form URL. [Getting started](/start/#discover-support) shows the full HTTP responses. The values below are fictional placeholders; replace them with the Host origin, Form URL, and credentials your Host operator provides.

```sh
export HOST_ORIGIN='https://host.example'
export FORM_URL='https://forms.publisher.example/key-value-entry/1.0.0'

# Discovery is unauthenticated; read baseUrl, authentication, and replayWindowSeconds.
curl --fail-with-body "$HOST_ORIGIN/.well-known/takoform/v2"
```

After checking Discovery's authentication documentation and `baseUrl`, query `support` for the exact Form URL:

```sh
export BASE_URL='https://host.example/apis/forms.takoform.com/v2'
export TOKEN='replace-with-a-short-lived-token'

curl --fail-with-body -G "$BASE_URL/support" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "form=$FORM_URL"
```

`supported: true` means the Host implements that Form; with `privateInputs: false` it does not cover uses of the Form that need [private inputs](/glossary#private-inputs), the Form-defined secret values. Support does not grant you access or capacity, which the Host operator's own documentation and terms decide.

## 2. Choose how to call it {#infrastructure-as-code}

| Your situation | What to use |
| --- | --- |
| Trying the API or scripting a few calls | Any HTTP client such as `curl`. The commands on this page and the full exchanges in [Getting started](/start/) can be adapted directly. |
| Building a client, CLI, or integration | [Implementing a client](/client/), for intent records, replay deadlines, and conflicts. |
| Terraform or OpenTofu | A Provider compatible with Host API v2 and the exact Form URL you need. Consult its version-specific documentation for supported Forms, state, import, and recovery behavior; check the Host separately for support and access. |
| A Host that speaks v1 | The [v1 documentation](/v1/); the Takoform Go client, [`hostclient`](https://pkg.go.dev/github.com/tako0614/takoform/hostclient), speaks v1. |

## 3. Track every change to its result {#client-responsibilities}

Each accepted create, update, or delete returns an Operation. Generate a fresh `Idempotency-Key` before each new change (if `uuidgen` is unavailable, `openssl rand -hex 16` works too), then send the request:

```sh
export SPACE='default'
CREATE_KEY=$(uuidgen)
```

```sh
curl --fail-with-body -i -X POST "$BASE_URL/resources" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $CREATE_KEY" \
  --data @- <<JSON
{"form": "$FORM_URL", "space": "$SPACE", "name": "greeting",
 "spec": {"key": "greeting", "value": "hello"}}
JSON
```

If the Host advertises `capabilities.offerings: true` in Discovery, include the chosen [`offering`](/spec/host-api/v2/http#offerings) in the body. If a response is lost, rerun only the `curl` command above with the same `$CREATE_KEY` before `replayWindowSeconds` elapses from your first send; after that window, reconcile from any known Operation and the Resource instead of resending.

Wait `Retry-After` seconds on a `202 Accepted`, then poll the Operation until its `status` is `succeeded` or `failed` and read the Resource to compare `generation` with `observedGeneration`:

```sh
OPERATION_ID='replace-with-the-Operation-id'
RESOURCE_UID='replace-with-the-resourceUid'

curl --fail-with-body "$BASE_URL/operations/$OPERATION_ID" \
  -H "Authorization: Bearer $TOKEN"

curl --fail-with-body "$BASE_URL/resources/$RESOURCE_UID" \
  -H "Authorization: Bearer $TOKEN"
```

Update (`PUT`) and delete (`DELETE`) address `/resources/$RESOURCE_UID`, use a new `Idempotency-Key`, and carry the `generation` you read in `Takoform-Expected-Generation`; see [Getting started](/start/#update) for both exchanges. A `409 generation_conflict` means the Resource has moved on and no Operation was created, so read again and decide what you still intend.

<a id="examples-status"></a>

The [request/response examples](/spec/host-api/v2/examples) show each of these outcomes. An Infrastructure as Code tool needs the same discipline in its state: lost responses, generation conflicts, and deletion outcomes must reconcile against Operations, not just a comparison of declared and remote values.
