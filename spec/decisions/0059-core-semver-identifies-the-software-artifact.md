# 0059 — Core SemVer identifies the software artifact

- Status: Accepted
- Date: 2026-08-28
- Scope: Domain version axes, Core module identity, Host API identity, and Core release provenance

## Context

Decision 0058 aligned a Takoform API release SemVer, the Core Go module tag,
and the Host wire major. That made a Core artifact update look like an API
minor release even though Hosts negotiate only the exact
`forms.takoform.com/v1` lane. It also risked presenting Core v1.1.0 as a Host
API v1.1 that has no discovery document, route, or wire contract.

Takoform's two domain version axes are the Host API wire lane and each Form's
`definitionVersion`. Core, Providers, packages, clients, formats, schemas, and
evidence still need exact release identities, but their artifact versions do
not become extra domain axes.

Core publication is also a consumer-pinned source operation. A reviewed branch
is useful for a read-only gate, but creating an immutable tag and GitHub Release
must prove that the candidate was already the public main commit without
depending on publisher credentials for that proof.

## Decision

The Go module `github.com/tako0614/takoform` has its own software artifact
SemVer. Core v1.1.0 is such an artifact release. It does not name or mint a
Takoform API version, and neither its major nor its minor is projected into a
Host address.

The current Host protocol identity remains exactly
`forms.takoform.com/v1`, discovered at `/.well-known/takoform/v1` and served
under `/apis/forms.takoform.com/v1`. There is no Host API v1.1. A future Host
wire major and a future Core module major require their own compatibility
decisions and are not required to use the same number.

The Core release entrypoint publishes the module tag and a GitHub Release titled
exactly `Takoform Core v1.1.0`. Publish mode requires local HEAD to equal a
credential-free read of public `refs/heads/main` before and after the owner
gate. Dry-run may validate a reviewed branch, but reports the main mismatch and
does not call it publish-ready. The post-publication verifier binds readback to
the exact candidate commit. Standalone historical verification instead checks
the immutable tag, exact-title Release, source archives, and public Go module
as one self-consistent identity, so it remains useful after main advances.

Decision 0058 remains historical evidence of the earlier aligned release
model, but its decision and consequences are superseded by this one.

## Consequences

- Core v1.1.0 is described and titled only as a Core software/module artifact.
- Host clients and Hosts continue to negotiate `forms.takoform.com/v1`; no
  `/v1.1` route, discovery lane, schema family, or Host capability is created.
- Core SemVer and Form `definitionVersion` cannot be used to infer one another
  or a Host wire version.
- An immutable Core publication cannot be created from a commit that has not
  already appeared as credential-free public main.
- Historical verification is independent of the repository's later HEAD,
  while publication verification remains pinned to the candidate commit.
