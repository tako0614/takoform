---
title: Guides by role
description: One v2 reading path each for users, client implementers, Form authors, and Host implementers, from the guides to the normative text.
---

# Guides by role {#guides}

Each role has one path: start with the guide pages, then read the normative text that settles the details. The home page and the [v2 entry](/v2/#reading) list the same roles in the same order.

## Users {#users}

You call a Host's API, directly or through a tool that explicitly supports v2.

1. [Getting started](/start/): one Resource from Discovery to delete.
2. [Using v2](/use/): check the Host and the exact Form, then choose how to call the API.
3. [Request/response examples](/spec/host-api/v2/examples): lost responses, conflicts, and partial failure.
4. [HTTP API](/spec/host-api/v2/http): the normative requests and responses.

## Client implementers {#client-implementers}

You build a client, CLI, or integration that sends changes on someone's behalf.

1. [Getting started](/start/): the requests your client will send.
2. [Implementing a client](/client/): Discovery and support, intent records, replay deadlines, Operations, and generation conflicts. Reconcile a lost response or conflict against Operations and Resources rather than blindly retrying.
3. [HTTP API](/spec/host-api/v2/http): the normative requests and responses, including the [retry contract](/spec/host-api/v2/http#retry).

## Form authors {#form-authors}

You define a kind of Resource for Hosts to implement.

1. [The v2 model](/model/): what a Form defines and what the Host API already covers.
2. [Create a Form](/authoring/): `spec`, `observed`, `output`, operation semantics, and recovery from partial failure.
3. [Form requirements](/spec/host-api/v2/forms): the normative requirements and the [author checklist](/spec/host-api/v2/forms#author-checklist).
4. [Publish the Form at its exact URL](/authoring/#publish) once it answers the checklist, and give that URL to the Host operators who will implement it and the clients who will request it.

## Host implementers {#host-implementers}

You run the server that implements Forms and serves the Host API.

1. [Implementing a Host](/host-api/): the durability boundary that keeps Resources, Operations, and Idempotency-Key records coherent across restarts.
2. [Overview](/spec/host-api/v2/), [HTTP API](/spec/host-api/v2/http), and [Form requirements](/spec/host-api/v2/forms): the normative contract. Then read each Form you implement.
3. [Check your Host](/host-api/#check) against the baseline probe, and plan the restart and fault experiments it leaves to you.

## Moving from v1 {#migration}

v2 does not require packages or Snapshots, and the specification does not automatically convert them. Check the product that owns existing Resources or Providers for its migration plan. The [v2 migration guide](/spec/host-api/v2/migration) explains questions to resolve; the [frozen v1 specification](/spec/host-api/v1) retains the earlier contract.
