# Current publication and change boundary

This tree is an unreleased post-1.1 draft. The predecessor W09 policy and
publication evidence are imported under
[`docs/extraction/history/`](../docs/extraction/history/README.md); they are
history, not current writer authority.

## Published identity

Takoform Specification 1.1 is immutable history published from
`github.com/tako0614/terraform-provider-takoform`. Its original source, tag,
Release, snapshot, and asset receipt remain exact in
[`release/specification-releases.json`](../release/specification-releases.json).
This repository must not recreate, retag, overwrite, or relocate it.
Specification 1.0 was never published, is withdrawn, and cannot be reused.

Editing `main` does not publish a Specification, Host API, Form, Form Package,
Interface, Binding, Provider, Host capability, activation, or Offering. The
literal `forms.takoform.com/v1` Host API remains an independent unpublished
candidate.

## Dormant writer

[`release/specification-authority.json`](../release/specification-authority.json)
remains `prepared-writer-disabled`. The repository may contain the reviewed P0
writer, adapter, policies, tests, and owning deploy interface, but every
release phase, including release verification, must reject before constructing an adapter or touching a
signer, credential, writer, package/source script, or network callback. There
is no CI writer, ambient root/bypass authority, or public identity implied by
dormant code.

P0 is an immutable transitive execution closure. P records P0 in its direct
authority-only child; predecessor tombstone T pins P; the separate first
schema-origin cutover must complete; and only then may direct authority-only A
activate the successor. A dual-writer interval and authority reopening are
forbidden. A later P0 program change requires another explicit authority
rotation; D, N, E, recovery, and receipt commits cannot change it. The exact
rules are in
[`release/specification-release-policy.md`](../release/specification-release-policy.md).

## Independent publication lanes

A future Specification `1.x` release may have zero schema additions, N equal
to D, and no Cloudflare mutation. A schema-only append/deploy has no
Specification version, tag, Release, or receipt. A composed operation may do
both, but neither identity depends on the other. The initial schema-origin
authority cutover remains a separate one-time authority transfer.

No current or future command in this lane may mint Specification 2.x, Host API
v2, a v2 schema/route/tag/receipt/Release, or claim a new public identity.
Design text for a possible v2 is allowed only below `spec/proposals/` with
exact `classification: non-normative-proposal` front matter. Normative source
snapshot creation and publication re-read exact D bytes and enforce that
classification.

Specification, Core SDK/CLI, Host API, each Form and Form Package, Provider,
Host implementation, support, activation, and commercial Offering remain
independent release axes. Official and third-party publishers use the same
package, verification, trust, revocation, installation, support, and activation
mechanisms; provenance may differ, but the contract has no official privilege
bit or bypass.

`bun run check` is a read-only portable gate. It does not publish, sign,
install, activate, deploy, or mutate a Resource.
