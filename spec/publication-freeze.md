# Current publication and change boundary

This tree is an unreleased draft after the historical Specification 1.1
snapshot. The predecessor W09 policy and publication evidence are imported under
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

## Closed writer boundary

Predecessor tombstone
`220d37b284d8288e6e12d31375ecfdca6a5f15c5` disables the old repository's
Specification and schema writers. The
cleanup child deletes the successor's dormant numbered writer, adapter,
policy, closures, rotations, deploy route, credential lanes, and activation
phase. Their exact P-tree byte digests survive only in
[`docs/extraction/history/w10-retired-specification-writer.json`](../docs/extraction/history/w10-retired-specification-writer.json).

Core owns the normative schema files and their immutable logical identities.
It owns no schema hosting Worker, route, account, zone, credential, deployment,
or platform-specific publication machinery; hosting is an external publisher
or operator concern. There is no CI writer, ambient root/bypass authority, or
executable/public authority for another numbered Specification 1.x. Neither
predecessor writer may reopen.

## Current revision and proposal lanes

Specification 1.1 is the sole numbered historical snapshot. There is no future
Specification 1.x stream. Compatible Host API v1 source revisions are
identified by exact commit, tree, and digest. Public schema formats and Core or
client releases retain their own append-only artifact identities without
becoming Takoform domain versions.

No current or future command may mint Host API v2, a v2
schema/route/tag/receipt/Release, or another numbered Specification identity.
Design text for a possible v2 is allowed only below `spec/proposals/` with exact
`classification: non-normative-proposal` front matter. A proposal changes no
released contract.

Takoform's two domain axes are Host API major and each Form's
`definitionVersion`. Form groups are namespaces; packages, Core SDK/CLI,
Providers, schemas, trust records, and Interface/Binding refs have exact
artifact identities. Official and third-party publishers use the same package,
verification, trust, revocation, installation, support, and activation
mechanisms; provenance may differ, but the contract has no official privilege
bit or bypass.

`bun run check` is a read-only portable gate. It does not publish, sign,
install, activate, deploy, or mutate a Resource.
