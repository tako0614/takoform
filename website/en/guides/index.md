---
title: Implementation guides
---

# Implementation guides {#実装ガイド}

Form publishers, Go client users and Host implementers need different starting
points. Choose the task below. This guide is non-normative; the linked
specifications define the implementation requirements.

| Task | Start here |
| --- | --- |
| Define and distribute resource settings and behavior | [Create a Form](/en/authoring/): definition → package → verification |
| Manage resources from a Go application | [Use a Host from Go](/en/client/): discovery → availability → prepare → apply |
| Verify existing packages | [Getting started](/en/start/): package verification and Snapshot construction |
| Implement a resource Host | Continue to the Host implementation section below for API and conformance requirements |

## Understand the architecture {#architect}

1. [Common model](/en/model/) — the relationship between FormRef, Form Package and Snapshot.
2. [Portability boundary](/en/spec/portability-boundary) — what a Form defines and what Hosts or operators decide.
3. [Versioning and compatibility](/en/spec/versioning) — API and Form versions versus implementation releases.

A Form describes service settings and behavior. Accounts, credentials, placement,
pricing and backend selection belong to the Host or operating environment.

## Work with packages in Go {#core-artifact-user}

1. Try package verification and Snapshot construction in [Getting started](/en/start/).
2. Read [Form Package](/en/spec/form-package/) for declared files and digest calculation.
3. Read [Snapshot](/en/spec/core/) for reference verification, defaults and order-independent construction.
4. Use the [`formpackage`](https://github.com/tako0614/takoform/tree/main/formpackage),
   [`snapshot`](https://github.com/tako0614/takoform/tree/main/snapshot) and
   [`trust`](https://github.com/tako0614/takoform/tree/main/trust) APIs.

These operations verify data. They do not connect to a Host or create resources.

## Implement a Host {#host-client-implementer}

1. Read the [Host API overview](/en/host-api/) for discovery and the API structure.
2. Implement the requests, responses, concurrency checks and errors in [Host API v1](/en/spec/host-api/v1).
3. Read [Interface](/en/spec/interface-contract/), [Binding](/en/spec/binding-contract/)
   and [Artifact transport](/en/spec/artifact-transport/) for the capabilities you need.
4. Check [Standard Services](/en/spec/standard-services/) when using external protocols.

Client-specific schemas, state management and import behavior belong to the client.
The Host manages backends, credentials, tenant policies and Form activation.

Start with discovery, availability, preparation, creation and reads for one Form.
Then implement and verify update conflicts, idempotent retries, asynchronous work
and errors. Successful HTTP exchanges are only part of the job: implement the
Form's promised behavior and the applicable [Host conformance checks](/en/conformance/).

## Interpret verification results {#verifier-reviewer}

1. Read [Conformance checks](/en/conformance/) for report scope and checks.
2. Read [Conformance](/en/spec/conformance) for requirement language and claim categories.
3. Read [Trust and revocation](/en/spec/trust/) for caller-supplied trust policy and verification data.

A valid package does not prove public availability or support on a particular Host.
Check publication and Host support with their respective owners.

## Use OpenTofu {#opentofu-provider-を使う-reader}

See [terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform)
for OpenTofu examples, provider schemas, state management and import behavior.

## Look up an individual Form {#この-site-にないもの}

Each publisher provides its own Form settings and examples. This site documents
the data formats and API shared by Forms.
