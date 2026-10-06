---
title: Guides
description: Choose a v2 learning path for users, Form authors, client implementers, or Host implementers.
---

# Guides {#guides}

Follow the v2 contract for the role you have. Examples are illustrative; publication of the common API specification does not indicate that a public Host or implementation is available.

## Users {#users}

1. Start with [Getting started](/start/) to distinguish a Form from a Host.
2. Check the chosen Host operator's guidance for Discovery, authentication, and Space access.
3. Read the exact Form URL and check that Host's `support` response.
4. Follow the [request/response examples](/spec/host-api/v2/examples) through Create, Operation tracking, and Delete.

## Form authors {#form-authors}

Publish a versioned Form URL and describe `spec`, `observed`, `output`, operation semantics, and recovery from partial failure. [Form requirements](/spec/host-api/v2/forms) are normative; the [examples](/spec/host-api/v2/examples) illustrate HTTP use with fictional data.

## Client implementers {#client-implementers}

Use the [client guide](/client/) to understand Discovery, support, Idempotency-Keys, generation conditions, and Operations. Treat the [HTTP API](/spec/host-api/v2/http) as the source of request and response requirements. Reconcile a lost response or conflict against Operations and Resources rather than blindly retrying.

## Host implementers {#host-implementers}

Read the [overview](/spec/host-api/v2/), [HTTP API](/spec/host-api/v2/http), and [Form requirements](/spec/host-api/v2/forms). Design authentication and Space authorization, Resource UIDs and generations, Idempotency-Key handling, Operation records, observed state, and post-restart recovery as one durability boundary.

## Moving from v1 {#migration}

v2 does not require packages or Snapshots, and the specification does not automatically convert them. Check the product that owns existing Resources or Providers for its migration plan. The [v2 migration guide](/spec/host-api/v2/migration) explains questions to resolve; the [frozen v1 specification](/spec/host-api/v1) retains the earlier contract.
