# Data-only Form Package

A Form Package is a closed local directory with a root `package-index.json` and
exactly the payload files listed by that index. Requirement keywords are used
as described in [`../conformance.md`](../conformance.md). The current Draft
2020-12 index profile is
[`package-index-v1alpha5.schema.json`](../schemas/package-index-v1alpha5.schema.json);
it carries one exact FormRef whose group may belong to any publisher.

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

## Verification rules

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

The current `trust.forms.takoform.com/v1` statement and checkpoint schemas use
stable versionless FormRefs. A new checkpoint chain begins with the signed
sequence-zero genesis defined in [`../trust/`](../trust/). Core derives a
checkpoint entry only from exact RFC 8785 statement bytes; pretty-printed or
otherwise noncanonical signed statement input is rejected rather than hashed
as different canonical bytes. Retained v1alpha1 statements and sequence-one
checkpoint starts remain readable under their original identities.

## Publication

The local report covers package bytes. A publisher that distributes a package
chooses its release cadence, provenance, signature, transparency, and revocation
policy. Project-maintained and independent publishers use the same checks; the
operator selects the provenance and trust policy. Acceptance by this verifier
alone does not publish a package.

## Verifier scope

The local verifier does not extract untrusted archives, fetch or install remote
packages, choose a publisher, verify an operator's trust policy, activate a
Form, implement a Host, build a client projection, or execute adapters. Those
decisions belong to the caller that owns the corresponding boundary.

Version and retained-profile rules are centralized in
[`../versioning.md`](../versioning.md).
