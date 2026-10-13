---
title: About this site
---

# About this site {#この-site-について}

Takoform is a common API and model for Hosts to provide resources defined by Forms. This site covers the API, Forms and implementation guidance.

Choose the API version in the header. All documentation is in English. Each specification page distinguishes normative text from explanation.

## Scope {#この-repository-が扱う範囲}

- Host API and common model: resource identity, requests, responses and operations.
- Form authoring: describing resource-specific inputs, outputs and behavior.
- Implementation guides and examples for users, Form authors, Hosts and clients.
- Retained v1 JSON Schemas served at their identifier paths, with each profile's applicability listed in the index.

Check individual Form details with its publisher and Host or client support with the product or environment you intend to use.

The guides use v2. The Go libraries and local package/Snapshot tools in this
repository implement v1. Specification publication, a passing local check and
support on a running Host are separate facts. This site hosts no resource API
or central Form catalog.

## Source and updates

The v1 and v2 normative texts are fixed. Examples, guides and site presentation
may be improved without changing those contracts. Generated reference pages
identify their source and whether the text is normative; the raw English v2
sources are linked from their specification pages. Previously published
`/en/` URLs redirect to the corresponding English root pages.

## References {#参考}

- [Schema index](/schemas/)
- [Source code](https://github.com/tako0614/takoform)
- [OpenTofu / Terraform HCL quick start](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start)
