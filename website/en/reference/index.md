---
title: Reference
---

# Reference {#仕様一覧}

Specifications for implementers and guides that explain them. This index is
non-normative and does not introduce requirements.

## Specifications {#仕様}

These specifications are frozen English originals. The notice at the top of each
page links to its repository source.

| Document | Contents |
| --- | --- |
| [Host API v1](/en/spec/host-api/v1) | HTTP endpoints, requests and responses |
| [Conformance](/en/spec/conformance) | Requirement language and conformance categories |
| [Versioning](/en/spec/versioning) | Versions, identities and compatibility |
| [Form Definition](/en/spec/form-definition/) | Resource settings and behavior |
| [Form Package](/en/spec/form-package/) | Distribution format and verification |
| [Snapshot](/en/spec/core/) | Verified packages and references |
| [Interface](/en/spec/interface-contract/) | Operations, inputs, outputs and errors |
| [Binding](/en/spec/binding-contract/) | Capabilities and roles for resource connections |
| [Artifact transport](/en/spec/artifact-transport/) | Content identification and transfer |
| [Standard Services](/en/spec/standard-services/) | References to external protocols |
| [Trust and revocation](/en/spec/trust/) | Signatures, trust policy and revocation data |
| [Form families](/en/spec/form-families) | Publisher-owned namespaces |
| [Portability boundary](/en/spec/portability-boundary) | Form semantics versus operating-environment decisions |

The frozen files and digests are listed in
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json).
The site preserves original specification prose and rewrites its link targets for
navigation. Repository files remain authoritative.

The [specification overview](/en/spec/), [Host API index](/en/spec/host-api/) and
[schema identity index](/en/spec/schemas/) are navigation pages, not frozen specifications.

## JSON Schema and verification data {#json-schemaと検証データ}

The [schema index](/en/schemas/) links to JSON files at the paths named by their
`$id`. Documents also need to satisfy the semantic constraints in the prose;
structural schema validation alone is not sufficient.

- [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
  — operations, concurrency checks, statuses and errors.
- [`generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json)
  — fixture manifest for package and Snapshot verification.

## Guides {#日本語ガイド}

Guides are available in Japanese and English. They explain the specifications
without adding requirements.

| Document | Contents |
| --- | --- |
| [Getting started](/en/start/) | Local verification and API request/response examples |
| [Implementation guides](/en/guides/) | Reading paths for different implementations |
| [Host API overview](/en/host-api/) | Discovery and API structure |
| [Common model](/en/model/) | Relationships between the main data types |
| [Conformance checks](/en/conformance/) | Reading verification reports |
| [Glossary](/en/glossary) | Terms used in the specifications |
| [About this site](/en/site) | Scope and publication |
