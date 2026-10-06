---
title: About this site
---

# About this site {#この-site-について}

This site explains Takoform, its HTTP API and how to write a Form specification.
The v2 normative source is English; Japanese guides provide translated guidance. Each specification page displays the English source and identifies its authority and publication status.
The v2 source remains open to revision. See [takoform.com](https://takoform.com/en/v2/) for the published version; local copies and previews may differ. Guides and examples are
distinct from normative requirements.

## Scope {#この-repository-が扱う範囲}

- [Host API v2](/en/v2/): design, requests, responses, retries and recovery.
- Form identity, publication, inputs, outputs and behavior.
- The unchanged v1 specification, public schemas, and existing v1 software guidance.
- Illustrative API examples. They do not identify a running Host or published Form.

Published individual Form settings and examples belong to their publishers. Check Host and
client support, credentials, pricing and operating requirements with the product
or environment you intend to use.
For HCL usage with an existing v1 Host, see the Provider's v1
[HCL quick start](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start).
This does not indicate v2 support. Each Form publisher maintains its own site for definitions and examples.

## Specifications and schemas {#identity-と配信}

V2 pages are generated from their English specification sources. Their source and
published, revision-open status appear on each specification page; the [overview](/en/v2/)
provides the reading map. The frozen v1 specification scope is recorded in
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json).
Public schema identities and digests are recorded in
[`public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json).

Schemas are served unchanged at the paths named by their `$id`. Presentation,
navigation and translation changes do not change specification or schema bytes.
Each specification retains its original language in both site locales.

## Checking support {#この-site-が主張しないこと}

These verification examples do not establish that a particular Host is running,
supports a Form or is ready for production use. Confirm the required conditions
with the publisher and the Host separately.

## Related pages {#source-を読む}

- [Read v2](/en/v2/)
- [Frozen Host API v1 specification](/en/spec/host-api/v1)
- [Reference](/en/reference/)
- [Schema index](/en/schemas/)
- [Source code](https://github.com/tako0614/takoform)
- [OpenTofu / Terraform HCL quick start](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start)
