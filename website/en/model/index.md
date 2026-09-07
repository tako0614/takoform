---
title: Common model
---

# Common model {#共通モデル}

A Form defines resource settings and behavior. A Form Package distributes the
definition. A Snapshot collects verified packages and their references.

Formats and verification rules do not vary by publisher. This guide is
non-normative; precise requirements are in the [reference](/en/reference/).

Matching configuration keys is not enough if updates or recovery after failure
mean different things. A Form also establishes common application-visible
behavior. Hosts conforming to the same definition preserve that promise;
services with different semantics should not be forced into the same Form.

A publisher creates a definition and package. Consumers verify their contents
and references into a Snapshot, and a Host implements supported Forms. Clients
check availability on that Host before making changes. This does not mean every
Host supports every Form.

## Identify a definition {#identity-の文法}

| Field | Meaning |
| --- | --- |
| Form Family namespace | A publisher-managed reverse-DNS name, without a version or `/` |
| FormRef | `apiVersion`, `kind`, `definitionVersion` and `schemaDigest` |
| `definitionVersion` | Compatibility version of a Form's settings and behavior |
| `schemaDigest` | Digest of the Form Definition canonicalized using RFC 8785 |
| `packageDigest` | Package index digest; not part of FormRef |

Changing the namespace changes the definition and its digest, producing a different Form.

Checking content digests as well as names and versions prevents a different
definition from being loaded as the same one. A Snapshot verifies referenced
definitions together so they cannot be substituted while it is in use. Content
integrity is not, by itself, a decision to trust the publisher.

## Main data types {#data-の層}

- [Form Definition](/en/spec/form-definition/) describes identity and desired, observed and output formats.
- [Form Package](/en/spec/form-package/) collects one definition and its declared files, without executable code.
- [Snapshot](/en/spec/core/) is built from verified data and references independently of input order.
  It is immutable after construction. Failed verification does not return a partial Snapshot.
- [Interface](/en/spec/interface-contract/) and [Binding](/en/spec/binding-contract/)
  describe operations and capabilities for resource connections. References identify
  definitions by digest rather than inferring behavior from names.
- [Artifact](/en/spec/artifact-transport/) identifies manifests and binary data by content digest.
  The digest itself is neither access permission nor a credential.
- [Standard Services](/en/spec/standard-services/) describe references to external protocols;
  actual delivery belongs to the Host.
- [Trust and revocation](/en/spec/trust/) verify distribution provenance under caller-supplied trust policy.

## How versions relate {#named-stream-は四つ、domain-axis-は二つ}

Host API and Form definitions have separate compatibility axes. Core and Provider
have their own implementation release streams.

| Subject | What the version describes |
| --- | --- |
| Host API | API compatibility; currently `forms.takoform.com/v1` |
| Form definition | Settings and behavior of each Form, identified by `definitionVersion` |
| Core | Go library and CLI releases; currently `v1.1.0` |
| Provider | Releases of the Terraform / OpenTofu implementation |

Updating Core or Provider does not automatically change an API or Form identity.
Schema/package `$id` values, Interface/Binding references and trust records do not
add further API/Form version axes. Host API has no minor-version URL.

## Publishers and Hosts {#publisher-の平等}

Core has no preferred-publisher list or `official` flag. Users and operators
supply a policy stating which publishers they trust.

Package verification, Host installation, support, activation and commercial
availability are separate. Check the conditions required by the Host you will use.

## Read next {#次に読む}

- [Getting started](/en/start/) — verify packages and build a Snapshot.
- [Host API overview](/en/host-api/) — resource management APIs.
- [Versioning and compatibility](/en/spec/versioning) — detailed rules.
- [Glossary](/en/glossary) — terminology.
