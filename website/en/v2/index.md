---
title: Host API v2
description: Read the Host API v2 concepts, fixed English specification and implementation guides.
---

# Host API v2 {#v2}

Host API v2 is a shared HTTP contract for creating, reading, updating, and deleting Resources managed by a Host. A Form defines Resource-specific meaning; the Host implements the Form; and the client operates with both in view.

## Specification source {#status}

The English normative source is fixed. Changes to protocol meaning require another API major. Each page distinguishes requirements from explanations; improvements to guides and site presentation do not change the normative text.

Before using a Host or client, verify its operator's endpoint, authentication, and Form support. Specification publication and implementation support are separate facts.

## v2 specification chapters {#chapters}

- [Overview and concepts](/en/spec/host-api/v2/) — Form, Host, Resource, Operation, and ownership boundaries.
- [HTTP API](/en/spec/host-api/v2/http) — Discovery, requests/responses, authorization, generations, retries, and errors.
- [Form requirements](/en/spec/host-api/v2/forms) — Resource-specific meaning that Form authors specify.
- [Request-to-delete examples](/en/spec/host-api/v2/examples) — A non-normative transcript with a fictional Host and Form.
- [Migration from v1](/en/spec/host-api/v2/migration) — Questions for an explicit product migration, not an automatic conversion procedure.

The overview, HTTP API, and Form requirements are the normative v2 chapters. Examples and migration guidance explain them without adding conformance requirements.

## Suggested reading order {#reading}

Refer to the [v2 glossary](/en/glossary) for terminology.

- **Users:** Follow the fictional HTTP walkthrough in [Getting started](/en/start/), then read the fuller [request/response examples](/en/spec/host-api/v2/examples).
- **Form authors:** Use [Form requirements](/en/spec/host-api/v2/forms) to define `spec`, `observed`, `output`, and failure behavior.
- **Client implementers:** Read the [client design guide](/en/client/) for intent records, replay deadlines, Operations, and generation conflicts; then consult the [HTTP retry contract](/en/spec/host-api/v2/http#retry).
- **Host implementers:** Start with the [Host implementation guide](/en/host-api/) for durability, then read the overview, HTTP API, and each implemented Form.
- **Existing v1 users:** Read [Migration](/en/spec/host-api/v2/migration), and consult the [frozen v1 specification](/en/spec/host-api/v1) for the earlier wire contract.
