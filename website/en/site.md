---
title: About this site
---

# About this site {#この-site-について}

Documentation for Takoform specifications, Go libraries and verification tools.
This guide is non-normative. Japanese and English guides explain the contracts;
the repository originals linked from each specification remain authoritative.

## Scope {#この-repository-が扱う範囲}

- Host API v1 and its request/response data formats.
- Shared mechanisms for Form definition, distribution and verification.
- Public JSON Schemas and instructions for verification tools.
- Executable Core examples using a fictional Form for packaging and a local HTTP fixture for the Go client.

Published individual Form settings and examples belong to their publishers. Check Host and
client support, credentials, pricing and operating requirements with the product
or environment you intend to use.

## Specifications and schemas {#identity-と配信}

The frozen specification scope is recorded in
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json).
Public schema identities and digests are recorded in
[`public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json).

Schemas are served unchanged at the paths named by their `$id`. Presentation,
navigation and translation changes do not change specification or schema bytes.
Specification bodies are the same English originals in either site language.

## Checking support {#この-site-が主張しないこと}

These verification examples do not establish that a particular Host is running,
supports a Form or is ready for production use. Confirm the required conditions
with the publisher and the Host separately.

## Related pages {#source-を読む}

- [Getting started](/en/start/)
- [Reference](/en/reference/)
- [Schema index](/en/schemas/)
- [Source code](https://github.com/tako0614/takoform)
- [Site build and publication](https://github.com/tako0614/takoform/blob/main/docs/site.md)
