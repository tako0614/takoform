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

## What is available today {#available}

- **From the Takoform repository.** The specification above, the guides on this
  site and a limited [HTTP baseline probe](/host-api/#check) that you run
  against your own Host. There is no v2 client library, reference Host or JSON
  Schema; the repository's [Go libraries and command-line tools](/v1/#go)
  implement v1.
- **Hosts and Forms.** takoform.com runs no Host and keeps no Form catalog, and
  the Hosts and Forms in the v2 pages use reserved example domains such as
  `host.example` and `forms.publisher.example`; they are fictional. A Host
  operator gives you its origin and the exact Form URLs it implements; a Form's
  author publishes its URL.
- **Terraform and OpenTofu.** The [Takoform Provider's version table](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#choose-a-provider-version)
  states which Host API each Provider version speaks.

Check the API version and exact Form support of the Host and client you use.

## Suggested reading order {#reading}

Refer to the [v2 glossary](/glossary) for terminology. [Guides by role](/guides/) gives each path in full.

- **Users:** Follow the fictional HTTP walkthrough in [Getting started](/start/), then check your Host and Form and choose how to call the API with [Using v2](/use/); the [request/response examples](/spec/host-api/v2/examples) show lost responses and conflicts.
- **Client implementers:** Read [Getting started](/start/) and [Implementing a client](/client/) for intent records, replay deadlines, Operations, and generation conflicts; then consult the [HTTP retry contract](/spec/host-api/v2/http#retry).
- **Form authors:** Read [The v2 model](/model/), then [Create a Form](/authoring/) to define `spec`, `observed`, `output`, and failure behavior; [Form requirements](/spec/host-api/v2/forms) settle the details.
- **Host implementers:** Start with [Implementing a Host](/host-api/) for durability, then read the overview, HTTP API, and each implemented Form. [Check your Host](/host-api/#check) against the baseline probe once its endpoints respond.
