---
title: Guides
description: Choose a v2 learning path for users, Form authors, client implementers, or Host implementers.
---

# Guides {#guides}

These guides explain how to apply the fixed Host API v2 contract by role. The Go SDK in this repository targets v1; check version support with the independent client and Host you plan to use. Examples are illustrative, and local artifact checks do not establish that a v2 Host is deployed.

## Users {#users}

1. Start with [Getting started](/start/) to distinguish a Form from a Host.
2. Read [Using v2](/use/) to choose a client or Infrastructure as Code provider that explicitly supports v2.
3. Check the chosen Host operator's guidance for Discovery, authentication, and Space access.
4. Read the exact Form URL and check that Host's `support` response.
5. Follow the [request/response examples](/spec/host-api/v2/examples) through Create, Operation tracking, and Delete.

## Form authors {#form-authors}

Publish a versioned Form URL and describe `spec`, `observed`, `output`, operation semantics, and recovery from partial failure. [Form requirements](/spec/host-api/v2/forms) are normative; the [examples](/spec/host-api/v2/examples) illustrate HTTP use with fictional data.

## Client implementers {#client-implementers}

Use the [client guide](/client/) to understand Discovery, support, Idempotency-Keys, generation conditions, and Operations. Treat the [HTTP API](/spec/host-api/v2/http) as the source of request and response requirements. Reconcile a lost response or conflict against Operations and Resources rather than blindly retrying.

## Host implementers {#host-implementers}

Read the [overview](/spec/host-api/v2/), [HTTP API](/spec/host-api/v2/http), and [Form requirements](/spec/host-api/v2/forms). Design authentication and Space authorization, Resource UIDs and generations, Idempotency-Key handling, Operation records, observed state, and post-restart recovery as one durability boundary.

## Moving from v1 {#migration}

v2 does not require packages or Snapshots, and the specification does not automatically convert them. Check the product that owns existing Resources or Providers for its migration plan. The [v2 migration guide](/spec/host-api/v2/migration) explains questions to resolve; the [frozen v1 specification](/spec/host-api/v1) retains the earlier contract.
