# 0058 — Takoform API and Core share the v1 release line

- Status: Superseded by [0059](0059-core-semver-identifies-the-software-artifact.md)
- Date: 2026-08-27
- Scope: API versioning, Go module identity, Host wire compatibility, and release entrypoint

## Context

Specification 1.1 is a sealed historical source receipt. It did not publish a
Host lane or an SDK. The current Host API v1 operation table, wire schema,
discovery schema, and support-profile schema are byte-identical to the W09
compatibility pins, while the extracted neutral Go module has reached its final
coordinate, `github.com/tako0614/takoform`.

Calling those same bytes an unpublished Host candidate, planning a separate
Core `v0.1.0`, and leaving a future numbered Specification writer would create
three visible version stories for one API distribution. Minor-looking changes
also need care because the v1 request, response, error, and endpoint envelopes
are closed; a field that is optional to a new decoder can still be rejected by
an old decoder.

## Decision

The first current release is **Takoform API 1.0.0**. The Go module tag
`v1.0.0` is the Core distribution of that same release. Core has no preceding
`v0.1.0`, independent public SemVer stream, or third Takoform version axis.

Takoform has two domain version axes only:

1. the Takoform API release SemVer, of which only the major is selected on the
   wire; and
2. each Form's independent `definitionVersion`.

API 1.0.0 keeps the exact Host API v1 identities
`forms.takoform.com/v1`, `/.well-known/takoform/v1`, and
`/apis/forms.takoform.com/v1`. API minor and patch checkpoints never become
route segments; there is no `/v1.1` lane.

`v1.0.x` is a compatible correction to the 1.0 baseline. A future `v1.y.0`
must be a meaningful, proven-compatible checkpoint on the unchanged v1 wire
lane. An optional field, error, endpoint, or other closed-envelope member is
not compatible by default. The change needs positive and negative old-peer
evidence, normally with an already-safe capability that prevents old clients
or Hosts from receiving or being required to send the new shape. If that proof
is absent, the change is incompatible.

An evidenced incompatible protocol requires one later decision that moves all
three identities together: API `v2.0.0`, Go module suffix `/v2`, and wire and
discovery suffix `/v2`. W19 remains an inert proposal; it creates no v2 module,
route, schema, tag, or receipt.

Specification 1.1 keeps its original name, bytes, repository, tag, and receipt.
It is never renamed, reissued, or treated as API 1.0.0, and no future numbered
Specification release stream continues after it. This decision supersedes only
the future-version and future-writer statements in decisions 0052, 0053, 0055,
0056, and 0057. It does not modify their historical account of Specification
1.1 or any immutable publication evidence.

The owning repository exposes the consumer-pinned publication through the one
ordinary entrypoint `bun run deploy -- core v1.0.0`; its
`bun run deploy -- --contract` form is side-effect-free. The facade delegates
to the minimal create-only tag and GitHub Release implementation. It carries no
release ledger, signer, credential broker, hosting system, or alternate
publication authority.

## Consequences

- Current source and conformance describe the API 1.0.0 release identity rather
  than an unpublished post-1.1 Specification draft or Host candidate.
- The API version and matching Go tag move together on v1; clients, Providers,
  Hosts, packages, and Forms retain their independently owned evidence and
  release cadence without becoming API prerequisites.
- Compatibility claims fail closed around the W09 machine pin and old-peer
  witnesses. A convenient additive schema diff is insufficient evidence.
- Incompatible work remains proposal-only until its simultaneous API, module,
  and wire-major transition is accepted. No `/v1.1` or premature `/v2`
  identity is introduced.
