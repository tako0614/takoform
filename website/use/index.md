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

Read the Host's Discovery document at `/.well-known/takoform/v2` for its API root, authentication, and `replayWindowSeconds`, then ask its `support` endpoint about the exact Form URL. [Getting started](/start/#discover-support) shows both requests and responses. `supported: true` means the Host implements that Form; with `privateInputs: false` it does not cover uses of the Form that need [private inputs](/glossary#private-inputs), the Form-defined secret values. Support does not grant you access or capacity, which the Host operator's own documentation and terms decide.

## 2. Choose how to call it {#infrastructure-as-code}

| Your situation | What to use |
| --- | --- |
| Trying the API or scripting a few calls | Any HTTP client. Every request in [Getting started](/start/) is a complete HTTP exchange you can adapt. |
| Building a client, CLI, or integration | [Implementing a client](/client/), for intent records, replay deadlines, and conflicts. |
| Terraform or OpenTofu | A Provider that explicitly supports Host API v2 and your Form. The [Takoform Provider's version table](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#choose-a-provider-version) states which Host API each of its versions speaks. |
| A Host that speaks v1 | The [v1 documentation](/v1/); the Takoform Go client, [`hostclient`](https://pkg.go.dev/github.com/tako0614/takoform/hostclient), speaks v1. |

## 3. Track every change to its result {#client-responsibilities}

Each accepted create, update, or delete returns an Operation. Send each new change with a new `Idempotency-Key`, follow the Operation until it finishes, then read the Resource and compare `generation` with `observedGeneration`. After a lost response, resend the identical request with the same key, but only within the `replayWindowSeconds` you read before the first send, counted from that send; after that, check any known Operation and the Resource to reconcile instead of resending. Update and Delete carry the generation you read; a `409 generation_conflict` means it has moved on and no Operation was created, so read again and decide what you still intend.

<a id="examples-status"></a>

The [request/response examples](/spec/host-api/v2/examples) show each of these outcomes. An Infrastructure as Code tool needs the same discipline in its state: lost responses, generation conflicts, and deletion outcomes must reconcile against Operations, not just a comparison of declared and remote values.
