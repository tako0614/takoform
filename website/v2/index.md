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

## Suggested reading order {#reading}

Refer to the [v2 glossary](/glossary) for terminology.

- **Users:** Follow the fictional HTTP walkthrough in [Getting started](/start/), then read the fuller [request/response examples](/spec/host-api/v2/examples).
- **Form authors:** Use [Form requirements](/spec/host-api/v2/forms) to define `spec`, `observed`, `output`, and failure behavior.
- **Client implementers:** Read the [client design guide](/client/) for intent records, replay deadlines, Operations, and generation conflicts; then consult the [HTTP retry contract](/spec/host-api/v2/http#retry).
- **Host implementers:** Start with the [Host implementation guide](/host-api/) for durability, then read the overview, HTTP API, and each implemented Form.
