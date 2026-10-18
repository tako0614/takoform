---
title: Host API v2
description: Read the Host API v2 specification, concepts and implementation guides.
---

# Host API v2 {#v2}

Host API v2 is a shared HTTP contract for creating, reading, updating, and deleting Resources managed by a Host. A Form defines Resource-specific meaning; the Host implements the Form; and the client operates with both in view.

## Read the specification {#chapters}

- [Overview and concepts](/spec/host-api/v2/) — Form, Host, Resource, Operation, and ownership boundaries.
- [HTTP API](/spec/host-api/v2/http) — Discovery, requests/responses, authorization, generations, retries, and errors.
- [Form requirements](/spec/host-api/v2/forms) — Resource-specific meaning that Form authors specify.
- [Request-to-delete examples](/spec/host-api/v2/examples) — A non-normative transcript with a fictional Host and Form.
- [Migration from v1](/spec/host-api/v2/migration) — Questions for an explicit product migration, not an automatic conversion procedure.

The overview, HTTP API, and Form requirements are normative. Examples and migration guidance explain the specification.

The Go libraries in the [Takoform repository](https://github.com/tako0614/takoform)
implement v1. For v2, the repository provides the contract, design guides and a
limited caller-driven [HTTP baseline probe](/host-api/#check).
Check the API version and exact Form support of the Host and client you use.

## Suggested reading order {#reading}

Refer to the [v2 glossary](/glossary) for terminology. [Guides by role](/guides/) gives each path in full.

- **Users:** Follow the fictional HTTP walkthrough in [Getting started](/start/), then check your Host and Form and choose how to call the API with [Using v2](/use/); the [request/response examples](/spec/host-api/v2/examples) show lost responses and conflicts.
- **Client implementers:** Read [Getting started](/start/) and [Implementing a client](/client/) for intent records, replay deadlines, Operations, and generation conflicts; then consult the [HTTP retry contract](/spec/host-api/v2/http#retry).
- **Form authors:** Read [The v2 model](/model/), then [Create a Form](/authoring/) to define `spec`, `observed`, `output`, and failure behavior; [Form requirements](/spec/host-api/v2/forms) settle the details.
- **Host implementers:** Start with [Implementing a Host](/host-api/) for durability, then read the overview, HTTP API, and each implemented Form. [Check your Host](/host-api/#check) against the baseline probe once its endpoints respond.
