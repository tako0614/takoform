---
# Generated from spec/host-api/v2/migration.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/host-api/v2/migration.md
sourceLanguage: en
releaseState: revision-open
---

<div lang="en" class="specification-source">

# Moving from Host API v1 to v2

This page is **non-normative** guidance for Form authors, Host implementers, clients, and Provider or SDK
maintainers who already use Takoform v1. Start with the [v2 overview](/en/spec/host-api/v2/) if v2 is your first
Takoform API. This page neither revises the frozen [v1 contract](/en/spec/host-api/v1) nor defines an automatic
conversion of existing Resources. The [v2 HTTP contract](/en/spec/host-api/v2/http) and [Form requirements](/en/spec/host-api/v2/forms) define
v2 behavior.

## What changes

v2 identifies a Form by the publisher’s immutable, version-specific HTTPS specification URL. A Host
implements that exact contract and reports support for it; the presence of a document at the URL does not
certify Host support or grant the Host permission to fetch and execute arbitrary content.

| Concern | v1 model | v2 model |
| --- | --- | --- |
| Form identity | Exact FormRef, including machine-readable Definition identity | Publisher-owned, version-specific absolute HTTPS specification URL, compared as a complete string |
| Specification delivery | Form Package, verification, and trust contracts | Human-readable normative specification published at that URL; machine-readable aids are optional |
| Host support | v1 installation and support-profile contracts | `GET {root}/support?form=...` for the exact URL |
| Resource change | v1 prepare/apply lifecycle and its fences | Direct create/update/delete; side-effect-free preview is optional |
| Result tracking | v1 resource and operation forms | v2 Resource and Operation envelopes with explicit generation, observation, effect, and retry behavior |
| Libraries and Providers | Their v1 compatibility scope | Each software release declares the API version and Form URLs it handles |

This table is a migration map, not a substitution rule for wire requests. Consult the
[frozen v1 HTTP specification](/en/spec/host-api/v1) for exact v1 messages and [v2 HTTP API](/en/spec/host-api/v2/http) for exact v2
messages.

A v2-only Host, client, or library can conform without v1 packages, signatures, Snapshots, `schemaDigest`,
prepare/apply, or old data envelopes. Adopting v2 does not require adding features to v1. An implementation
may independently use signatures or other supply-chain controls, but these are not conditions of
participation in the common v2 API. No specific SDK, toolkit, or Terraform Provider is required.

## Keep the v1 contract and existing use intact

Published v1 prose, schemas, reference URLs, tags, and releases retain their original meaning and bytes;
the [v1 freeze record](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json) identifies the frozen set. Do not overwrite a v1 URL with v2
prose or redirect it to a v2 Form. New Takoform specification design, guidance, and adoption focus on v2,
but third parties are not prohibited from continuing to implement or use v1.

Each Host decides and communicates its own v1 support period, and each library its maintenance period. A
service also owns the policy for retaining existing v1 Resources. The public availability of a frozen API
specification does not imply that a particular service still serves that API.

## Form-author checklist

Publishing an old machine-readable Definition at a new URL is not enough. Supply a specification that a
user and an independent Host implementer can read and agree on.

1. Choose a version-specific HTTPS URL and a name that conveys the Resource’s meaning.
2. Define inputs, private inputs if any, observations, outputs, omission and update behavior.
3. Define create/read/update/delete success and recovery or cleanup of partial failure.
4. Define references, ownership boundaries, and any Interface or Binding conditions.
5. Work through examples to check that independent implementations reach the same meaning.

The [Form requirements and complete example](/en/spec/host-api/v2/forms) give the normative detail. A v1 Definition or
distribution artifact may remain useful background, but it does not automatically specify the same contract
as a new v2 URL. Name the exact URL whose meaning is implemented.

## Host, client, Provider, and SDK checklist

Implement v2 requests and responses and the particular Forms you choose to support. A product may share a
backend with its v1 implementation or use an independent one; a cross-version translation layer is not a v2
conformance requirement.

If more than one API controls the same underlying Resource, maintain UID-level generation and execution
exclusion *across* those APIs. Idempotency keys, however, have separate API-version scopes. A v1 request
resent under a v2 key is not defined to be the same Operation. Reconcile a lost acknowledgement using the
**original API and operation contract**.

Make supported API versions and Form URLs visible to users of a Provider or SDK. A software upgrade is not
itself a migration of Provider state or existing Resources. If a product offers import or conversion, that
product must describe exactly what it can convert, how it preserves identity and effect evidence, and what
happens on failure; the v2 common API does not provide such a migration operation.

## Before adopting an existing Resource

A normal v2 update neither changes a Resource’s Form URL nor moves its backend. Merely switching API
versions does not adopt an old object or convert it to a new Form. To avoid recreating or double-managing
an existing object, a product-specific migration plan should answer:

- Which identifiers prove the relationship between the original object and the proposed new management record?
- Which API and Operation will reconcile accepted, running, or unknown-result work?
- Which data, private values, references, and connection endpoints can be preserved?
- What prevents old and new controllers from mutating the same object concurrently?
- If migration stops halfway, how can it resume, and what state can actually be restored?
- After migration, can the new owner read, update, and delete the object safely?

These are planning questions, not a common Host migration feature or a demand to implement both APIs. A new
v2 user need not migrate any v1 Resource.


</div>
