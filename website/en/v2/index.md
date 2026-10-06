---
title: Host API v2
description: Understand v2 concepts, how to read its normative chapters, and the English source's revision and publication status.
---

# Host API v2 {#v2}

Host API v2 is a shared HTTP contract for creating, reading, updating, and deleting Resources managed by a Host. A Form defines Resource-specific meaning; the Host implements the Form; and the client operates with both in view.

## Source and current status {#status}

The normative source is English and remains open to revision. Each page labels its source language and distinguishes normative requirements from explanations. The published version is at [takoform.com](https://takoform.com/en/v2/). Local copies and previews may contain different text.

This status does not establish that a Host or implementation is running or conformant. Before using a Host or client, separately verify its operator's endpoint, authentication, and Form support.

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
