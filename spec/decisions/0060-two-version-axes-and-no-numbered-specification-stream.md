# 0060 — Two version axes, and no numbered Specification stream

- Status: Accepted
- Date: 2026-09-29
- Supersedes: the numbered document-set release parts of decisions 0052, 0053, 0055, and 0057

## Decision

Takoform has exactly two version axes that express compatibility:

1. the Takoform API version, the literal `forms.takoform.com/v1`; and
2. each Form's own `definitionVersion`.

Core library and Provider release numbers are ordinary SemVer for software
artifacts. They identify builds of code, and they are never Takoform API
versions. Schema `$id`s, digests, package identities, and repository records
are not additional axes either.

There is no numbered Specification release stream: no `Specification 1.0`, no
`Specification 1.1`, no `Specification 1.x` lane, and no reserved successor.
The concept is retired, not deferred. It must not return as a version stream, a
document-set number, or a release channel, and it must not be reintroduced in
current documentation. A document set that has to be numbered in order to be
published is itself a third compatibility axis, and that axis does not exist.

## What the sealed receipt is, and is not

The predecessor repository published one immutable snapshot of its Host API v1
specification bytes under the annotated tag `specification/1.1` (GitHub Release
377480828), recorded in
[`release/specification-releases.json`](../../release/specification-releases.json).
That publication is preserved as a sealed historical receipt of provenance:
these were the bytes at that time.

It is not a version of the API, not a selectable release, and not a stream that
can advance. The API version was and remains the literal
`forms.takoform.com/v1`. The sealed bytes stay unchanged, including the
withdrawn 1.0 identity that was never published. Re-signing or renaming those
records would rewrite an external immutable receipt, so that is an operator
decision rather than a documentation change; this decision therefore leaves the
bytes alone and states their meaning instead.

## Consequences

- Decisions [0052](0052-the-specification-is-released-on-its-own-line.md),
  [0053](0053-specification-and-provider-release-evidence.md),
  [0055](0055-specification-release-needs-only-normative-source.md), and
  [0057](0057-specification-1-1-compatibility-and-independent-identities.md) are
  historical records of a numbering scheme that no longer exists. Their
  separation of document publication from API, Form, Core, and Provider
  releases still stands; their numbering vocabulary is not current policy.
- `scripts/docs-boundary.mjs` rejects a positive reintroduction of the
  numbered document-set vocabulary in current documentation, so the concept
  cannot return by prose alone.
- Compatibility rules a reader needs are in [`../versioning.md`](../versioning.md)
  and [`../host-api/v1.md`](../host-api/v1.md).
