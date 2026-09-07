---
title: Glossary
---

# Glossary {#用語集}

This guide is non-normative. For precise definitions and verification conditions,
use the [reference](/en/reference/).

| Term | Meaning |
| --- | --- |
| `Form` | Service or resource settings and behavior defined independently of an implementation. |
| `Form Definition` | Data describing a Form's identity, desired/observed/output schemas, operations and resource relationships. |
| `FormRef` | An exact definition identified by `apiVersion`, `kind`, `definitionVersion` and `schemaDigest`. |
| `Form Family` | A publisher-owned namespace for Forms, written in reverse-DNS form without a version. |
| `Form Package` | A distribution unit containing one Form definition and its declared files; it contains no executable code. |
| `Core` | Go libraries for package verification, Snapshot construction, Host API clients and trust verification. |
| `Snapshot` | Immutable verified packages, Interfaces, Bindings and references, constructed independently of input order. |
| `Host API` | HTTP discovery, resource management, asynchronous operations, concurrency control and errors. Its API version is `forms.takoform.com/v1`. |
| `Host` | An implementation that serves Host API and creates and manages resources for supported Forms. |
| `Operation` | A record of acceptance and eventual completion of a long-running action. |
| `Interface` | Digest-bound operations, inputs, outputs, errors and consistency semantics. |
| `Binding` | Digest-bound capabilities and roles needed at the source and target of a connection. |
| `Artifact` | Manifests and binary data identified by content digest. A digest is not a credential. |
| `Standard Service` | A defined reference to an external protocol; the Host implements its delivery. |
| `publisher` | The party publishing Form/package sources, provenance and distribution artifacts. |
| `client adapter` | An implementation mapping Snapshot and Host API to client-specific schemas and state management. |
| `Conformance` | Verification that specified data or an implementation satisfies the stated requirements. |
| `trust / revocation` | Offline verification of signatures, provenance and revocation data under caller-supplied policy. |
| `desired` | The state a user requests for a resource. |
| `observed` | The current state observed and returned by the Host. |
| `output` | Results following the Form's declared types, not Host secrets or internal configuration. |
| `schemaDigest` | SHA-256 digest of the canonically encoded Form Definition; part of FormRef. |
| `packageDigest` | SHA-256 digest of the canonically encoded package index; not part of FormRef. |
| `uid` | Immutable Host-issued resource identity. Deleting and recreating the same name changes it. |
| `generation` | A number that advances with desired-state changes and participates in concurrency control. |
| `revision` | A number that advances with response-data changes, including status/output, and participates in concurrency control. |

Verification, publication, Host installation, support, activation and commercial
availability are separate states. Evidence for one does not establish the others.
