---
title: Glossary
description: Key Host API v2 terms, organized around the distinction between Form and Host responsibilities.
---

# Glossary {#glossary}

## Form {#form}

A versioned specification URL published by its author. It defines Resource meaning and operation requirements; it is not itself a Host or execution environment.

## Host {#host}

A service that implements Forms and exposes a Resource API to authenticated clients. Support for a particular Form varies by Host.

## Resource {#resource}

An object managed by a Host. It has a UID, Form URL, Space, name, generation, `spec`, `observed`, `output`, and other fields defined by the contract.

## spec {#spec}

The accepted desired state of a Resource. Update replaces the complete document.

## observed {#observed}

The latest state checked by the Host. It can lag behind the desired generation.

## output {#output}

Operation results or connection information whose meaning is defined by the Form. It may be empty.

## generation / observedGeneration {#generation-observedgeneration}

`generation` identifies an accepted desired-state version. `observedGeneration` identifies the version reflected by `observed`.

## Operation {#operation}

A record of progress and outcome for Create, Update, or Delete. A client reads it and may fetch the Resource again.

## Idempotency-Key {#idempotency-key}

A client-provided key that identifies retries of the same request. A retry using the key must preserve the original request contents.

## Space {#space}

A Resource scope within a Host. Naming a Space does not grant permission to use it.

## v1-only terms {#v1-terms}

FormRef, Form Package, Snapshot, revision, and `schemaDigest` belong to the frozen v1 contract. They are not synonyms for a v2 Form URL or Resource generation. See the [frozen v1 specification](/en/spec/host-api/v1).
