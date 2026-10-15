---
title: Guides by role
description: Choose a v2 learning path for users, Form authors, client implementers, or Host implementers.
---

# Guides by role {#guides}

Each section is a reading path for one role, from the first page to the normative text that settles the details.

## Users {#users}

1. Start with [Getting started](/start/) to see one Resource from Discovery to delete.
2. Follow [Using v2](/use/) to check your Host and Form, then choose how to call the API.
3. Use the [request/response examples](/spec/host-api/v2/examples) for lost responses, conflicts, and partial failure.

## Form authors {#form-authors}

Design the Form with [Create a Form](/authoring/): `spec`, `observed`, `output`, operation semantics, and recovery from partial failure. Then [publish it at its exact URL](/authoring/#publish) and give that URL to the Host operators who will implement it and the clients who will request it. [Form requirements](/spec/host-api/v2/forms) are normative; the [examples](/spec/host-api/v2/examples) illustrate HTTP use with fictional data.

## Client implementers {#client-implementers}

Use the [client guide](/client/) to understand Discovery, support, Idempotency-Keys, generation conditions, and Operations. Treat the [HTTP API](/spec/host-api/v2/http) as the source of request and response requirements. Reconcile a lost response or conflict against Operations and Resources rather than blindly retrying.

## Host implementers {#host-implementers}

Read the [overview](/spec/host-api/v2/), [HTTP API](/spec/host-api/v2/http), and [Form requirements](/spec/host-api/v2/forms). Design authentication and Space authorization, Resource UIDs and generations, Idempotency-Key handling, Operation records, observed state, and post-restart recovery as one durability boundary; the [Host implementation guide](/host-api/) walks through it. Then [check your Host](/host-api/#check) against the baseline probe and plan the restart and fault experiments it leaves to you.

## Moving from v1 {#migration}

v2 does not require packages or Snapshots, and the specification does not automatically convert them. Check the product that owns existing Resources or Providers for its migration plan. The [v2 migration guide](/spec/host-api/v2/migration) explains questions to resolve; the [frozen v1 specification](/spec/host-api/v1) retains the earlier contract.
