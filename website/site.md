---
title: About this site
---

# <span id="この-site-について"></span>About this site {#about}

Takoform is a common API and model for Hosts to provide resources defined by Forms. This site covers the API, Forms and implementation guidance.

Choose the API version in the header. All documentation is in English. Each specification page distinguishes normative text from explanation.

## <span id="この-repository-が扱う範囲"></span>Scope {#scope}

- Host API and common model: resource identity, requests, responses and operations.
- Form authoring: describing resource-specific inputs, outputs and behavior.
- Implementation guides and examples for users, client implementers, Form authors and Host implementers.
- Retained v1 JSON Schemas served at their identifier paths, with each profile's applicability listed in the index.

Check individual Form details with its publisher and Host or client support with the product or environment you intend to use.

The guides use v2. The Go libraries and local package/Snapshot tools in the
[Takoform repository](https://github.com/tako0614/takoform) implement v1.
Specification publication, a passing local check and support on a running Host
are separate facts. This site hosts no resource API or central Form catalog.

## Source and updates

The v1 and v2 normative texts are fixed. Examples, guides and site presentation
may be improved without changing those contracts. Generated reference pages
identify their source and whether the text is normative; the raw English v2
sources are linked from their specification pages. Previously published
`/en/` URLs redirect to the corresponding English root pages.

## <span id="参考"></span>References {#references}

- [Schema index](/schemas/)
- [Source code](https://github.com/tako0614/takoform)
- [Takoform Provider for OpenTofu / Terraform](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#choose-a-provider-version)
