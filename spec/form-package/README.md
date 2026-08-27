# Data-only Form Package

A Form Package is a closed local directory with a root `package-index.json` and
exactly the payload files listed by that index. Requirement keywords are used
as described in [`../conformance.md`](../conformance.md). The current Draft
2020-12 index profile is
[`package-index-v1alpha5.schema.json`](../schemas/package-index-v1alpha5.schema.json);
it carries one exact FormRef whose group may belong to any publisher.

The occupied predecessor package profiles remain verify-only schemas. Their
bytes and identities are retained so an exact old package can be read or
recovered; they are not aliases for the current profile and do not grant a
publisher or client any current authority.

One package MUST contain exactly one Form Definition and therefore exactly one
FormRef. There is no `packageId` and no multi-Form `definitions` collection. A
catalog or compatibility set is an external mapping of exact
`(FormRef, packageDigest)` pairs, not a wider package.

A Form Package carries a Form Definition and data-only supporting files. Core
does not define a separate Interface or Binding Package envelope; those
contracts are acquired and pinned independently by a caller
([`interface-contract/`](../interface-contract/),
[`binding-contract/`](../binding-contract/)).

## Index and identity

`package-index.json` carries one `definitionPath` and a lexicographically sorted
`files` array. Every file entry records a canonical relative slash path, an
allowlisted data media type, its byte length, and a lowercase `sha256:` digest
over the exact payload bytes.

The package identity is SHA-256 over the RFC 8785 canonical index. The index
does not list itself. `FormRef.schemaDigest` separately covers the canonical
Form Definition. An archive is transport only: its headers and compression
MUST NOT contribute to either identity.

`packageDigest` is the verifier result used by a caller's mapping or Snapshot
input; it is not a self-referential field in the index. A content-addressed
package has no independent SemVer: the Form's `definitionVersion` is the
compatibility version and the package digest identifies distribution bytes.

## Local verifier

[`../../formpackage/`](../../formpackage/) and
[`../../cmd/form-package/`](../../cmd/form-package/) provide the offline
library and CLI verifier. Verification performs no network access and executes
no package content. It rejects:

- duplicate JSON names, invalid UTF-8/Unicode, non-finite numbers, and negative
  zero before RFC 8785 canonicalization;
- missing, duplicate, unsorted, unlisted, or extra payloads;
- digest, byte-size, media-type, FormRef, or Definition identity mismatches;
- absolute, traversal, backslash, volume/URI-like, or non-canonical paths;
- symlinks, executable mode bits, executable-code extensions, devices, sockets,
  and pipes;
- non-UTF-8/NUL text and forbidden Form Definition content classes;
- schema object admission that cannot be proven closed, cyclic or non-local
  references, and proofs exceeding the configured graph and operation budgets;
- validation-work estimates above the configured limit;
- `contentEncoding`, `contentMediaType`, and `contentSchema`, because portable
  Forms do not decode an embedded second document;
- the legacy `dependencies` applicator; and
- more than 32 positive or more than 32 negative data fixtures per Definition.

Local `$ref` targets are admitted once per canonical JSON Pointer with explicit
`visiting`/`done` states. The verifier bounds both schema-proof work and
instance-aware fixture validation work; cycles and resource-exhaustion inputs
fail closed. The published JSON Schemas are structural minima, so semantic
identity, filesystem closure, canonicalization, reference-proof, work-limit,
fixture, and portable-content checks are also normative.

Allowed payload media types are the Form Definition type, JSON Schema, generic
JSON fixture data, Markdown, and plain text. Index, file, and file-count limits
are checked before content is read.

On Unix platforms, the verifier holds the package root descriptor and resolves
every payload path relative to it with no-follow fences. Inventory and metadata
fences detect ordinary mutation but do not claim an atomic snapshot against a
malicious concurrent writer. On other platforms callers MUST copy or extract
into a private immutable staging directory before verification.

The current CLI entry points are:

```console
go run ./cmd/form-package version
go run ./cmd/form-package verify PATH
go run ./cmd/form-package canonicalize FILE.json
go run ./cmd/form-package digest FILE.json
go run ./cmd/form-package validate-revocation STATEMENT.json
go run ./cmd/form-package validate-revocation-checkpoint CHECKPOINT.json
```

## Release and trust boundary

Verification is not publication. A publisher that elects to distribute a
package chooses its own release cadence, provenance, signature, transparency,
and revocation policy. Project-maintained and independent publishers use the
same checks; the only difference is the provenance and trust policy selected
by the operator. No package is publishable merely because this local verifier
accepts it.

Historical predecessor publication workflows and package locator grammars are
retained at the [immutable W09 source](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36)
for compatibility reading only. They are not current Core release commands or
authority.

## Deliberate non-goals

The local verifier does not extract untrusted archives, fetch or install remote
packages, choose a publisher, verify an operator's trust policy, activate a
Form, implement a Host, build a client projection, or execute adapters. Those
decisions belong to the caller that owns the corresponding boundary.
