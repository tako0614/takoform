# Conformance language and classes

## Requirement keywords

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
specification are interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14)
([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they
appear in all capitals.

Prose without those keywords is explanatory. A normative JSON Schema is the
structural minimum for its document, not the complete acceptance contract.
Implementations MUST also enforce the semantic verifier rules in the owning
Form Definition, Form Package, Interface, Binding, artifact, and trust
sections; schema validity alone is therefore not sufficient.

Where prose and a normative schema disagree about the same structural
condition, **the schema wins**. Semantic rules that a schema cannot express add
fail-closed requirements rather than contradicting it. Every normative schema
is listed in [`schemas/`](schemas/).

## Independent conformance claims

Conformance is scoped to the artifact or implementation named by a report. A
package claim does not claim Host Support; a Host claim does not publish a
package; a client claim does not define Form semantics; and a publisher trust
claim does not certify an implementation. Project-maintained and independent
publishers use the same data and trust mechanisms.

### Form Package data

A **conforming Form Package** MUST satisfy
[`form-package/`](form-package/) and [`form-definition/`](form-definition/):
one Definition, one exact FormRef, RFC 8785 canonical bytes, a closed file
inventory, allowlisted data media types, and no executable, credential,
placement, or commercial content. It MUST NOT depend on a Host to be valid.

### Interface and Binding data

A conforming exact Interface or Binding artifact MUST satisfy its digest-bound
reference and Definition schema, canonical bytes, closed operation/capability
vocabulary, and portable-content policy. A caller may acquire these documents
from any publisher; the digest, not a built-in catalog, determines identity.

### Core Snapshot artifact

The current generic artifact corpus is
[`../conformance/takoform-v1/generic.json`](../conformance/takoform-v1/generic.json).
It verifies, for caller-supplied inputs:

- package index and payload closure, digests, and exact Form identity;
- Interface and Binding Definition bytes and digest pins; and
- deterministic compilation into an immutable Snapshot, including exact
  reference closure, defaults, permutation stability, and no-partial-result
  behavior.

The corpus is deliberately family-neutral. It uses synthetic reverse-DNS
groups and accepts zero family packages; no official roster or preferred
namespace is required.

The generic corpus verifies package, contract, and Snapshot artifacts only. It
does **not** execute Host lifecycle requests, fencing, relation mutation,
runtime code, placement, activation, Host Support, or every publisher's family
semantics. Those are independent evidence obligations for the Host or publisher
that makes the corresponding claim.

The matching command is:

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

The command reads no network state and does not mutate a Resource. A failed
verification produces no usable partial Snapshot.

### Host protocol

A **conforming Host** is an implementation claim against an exact Host API
lane, such as [`host-api/v1.md`](host-api/v1.md). Its own evidence MUST cover
the discovery, wire, lifecycle, optimistic-concurrency, idempotency,
identity, relation, artifact, and error rules that it claims. Such a report is
not produced by the generic artifact corpus and does not grant publication,
Form maturity, or universal support.

### Client adapter

A **conforming client adapter** MUST send only declared desired state, preserve
the exact FormRef and package digest boundaries, and fail closed when it cannot
carry an occupied identity or migration. Its local schema, state, import, and
codec choices are client-owned and are not part of neutral Core.

### Publisher trust

A **conforming publisher workflow** (when one is used) MUST keep released bytes
immutable, record exact digests and provenance, and use an append-only
revocation policy. Core accepts caller-supplied trust inputs and performs
offline checks; it does not choose a publisher, grant an official bypass, or
claim that a package was published.

## What conformance is not

Passing package, contract, and Snapshot checks proves only those data and
compiler properties. It is not evidence of a running Host, lifecycle
execution, fencing, Host Support, production activation, Form maturity,
revocation enforcement, or interoperability with a particular backend. Those
facts require readback from the party that actually performed the external
operation. The lifecycle requirements are owned by
[`project-lifecycle.md`](project-lifecycle.md).
