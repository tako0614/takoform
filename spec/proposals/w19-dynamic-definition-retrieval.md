---
classification: non-normative-proposal
---

# W19 candidate: dynamic canonical Definition retrieval

Status: proposal only. W19 is **not complete**. W12, W14, and W17 are
prerequisites and their witness work is still pending. This document records a
candidate seam; it does not promote, publish, or implement it.

## The concrete v1 limitation

The current Host API v1 `form-definition` operation is a read-only request to
`/apis/forms.takoform.com/v1/form-definitions/{formGroup}/{kind}`. Its exact
query names `space`, `definitionVersion`, and `schemaDigest`, but the closed
`formDefinitionResponse` contains only `identity`, optional display text, and
`desiredSchema` (`spec/host-api/operations-v1.json` and
`spec/schemas/host-api-wire-v1.schema.json`).

That is not a complete Form Definition. The current Definition profile also
requires `role`, `requiresHostApi`, and `lifecycleCapabilities`, and may carry
constraints, observed/output schemas, and Interface/Binding references
(`spec/schemas/form-definition-v1.schema.json`). The canonical Definition bytes
are therefore unavailable to a dynamic client. The `schemaDigest` in the
echoed FormRef is an expectation, not proof: the client has no canonical byte
sequence to hash and compare. The role is likewise absent, so a client cannot
decide whether identity, revision, deployment, attachment, or policy semantics
apply. Reconstructing a Definition from `desiredSchema` would silently omit
these fields and is not verification.

This is a wire limitation, not a missing client convenience. The existing
`hostclient.GetFormDefinition` deliberately returns the desired-state subset
and fails only when that subset or the exact echoed FormRef is missing. It must
not be described as a verified dynamic Form loader.

## Candidate future seam (design text only)

A later, separately reviewed Host API v2 design may expose a complete
Definition as canonical UTF-8 RFC 8785 bytes (for example, an explicitly
byte-preserving `definitionBytes` member in an illustrative response). The
following are invariants, not a published schema or route:

1. The request and response name the exact four-member FormRef. The Definition
   bytes repeat `apiVersion`, `kind`, and `definitionVersion`; the client
   decodes strict I-JSON and verifies those values and the selected Host lane.
2. The client computes SHA-256 over the received canonical bytes and requires
   equality with `formRef.schemaDigest`. A missing, non-canonical, substituted,
   truncated, or mismatched body is a fail-closed read error before planning or
   mutation.
3. The client validates the complete Definition profile, reads `role` from
   those verified bytes (never from an unbound side field), and enforces the
   role's lifecycle rules and declared capabilities.
4. Publisher trust remains caller-supplied. A Host assertion is not a trust
   root. Dynamic use requires independently verifiable package/provenance
   evidence bound to the same Definition bytes and an operator-selected
   issuer/source/workflow/ref policy. Missing or misbound evidence disables
   dynamic use; it does not widen trust.
5. Installation, support, activation, and client projection remain separate
   facts. Retrieval and verification alone grant no permission and create no
   Resource.

The byte transport, provenance envelope, and exact error names require a
separate v2 design review. This proposal intentionally does not add optional
fields to a closed v1 response to simulate that lane.

## Coexistence and downgrade rules

- A future lane and v1, if ever promoted, use one Host-owned Resource
  lifecycle authority. They do not create parallel ledgers or reinterpret a
  stored FormRef.
- Lane selection is explicit in discovery and in each client operation. An
  unknown, unavailable, or malformed future lane is not permission to try v1
  dynamic retrieval.
- A dynamic client may use v1 only with an explicitly predeclared, compatible
  typed projection and operator policy. It must never guess from a `kind`,
  `latest` value, a partial response, or a discovery failure. If no such
  projection exists, it fails closed.
- A v1 client continues to use its existing exact FormRef and retained
  read/delete behavior. A future client does not silently rewrite that identity
  or downgrade a resource to a different Definition.

## Evidence required before any promotion decision

All rows below are **pending**. No independent publisher, Host, or client
readback is attached to this proposal.

| Witness | Required independent evidence | Status |
| --- | --- | --- |
| Publisher family A | W12 supplies one publisher-controlled reverse-DNS family, its exact Definition/package bytes, a role-bearing Form, and an operator policy whose signed provenance binds the Definition digest. | pending (W12 incomplete) |
| Publisher family B | W14 supplies a second independently maintained family and source/trust policy; it must exercise the same retrieval and verification path without a family allowlist or shared publisher authority. | pending (W14 incomplete) |
| Host/client pair A | W17 names a Host implementation and an independently authored dynamic client. A read-only corpus proves exact discovery, full-byte retrieval, role/schema-digest checks, trust failures, and no mutation on every failure. | pending (W17 incomplete) |
| Host/client pair B | A second independently authored Host/client pair repeats the corpus, with no copied implementation or hidden shared lifecycle ledger. | pending (implementation not nominated) |

Each family/pair must also show, for both a valid and adversarial response:

- same bytes on repeated readback and a recomputed digest equal to the exact
  FormRef;
- rejection of a changed byte, changed role, missing required Definition
  member, or substituted FormRef before any install/apply/activate operation;
- rejection of an untrusted or misbound issuer/source/workflow/ref; and
- two families with the same Kind remaining distinct by group and exact digest.

The coexistence corpus must exercise explicit v1/future-lane negotiation,
discovery failure without silent downgrade, v1 retained read/delete, and a
readback after every allowed transition. The rollback record must say how to
abandon an unpromoted candidate without touching Host state and, if a later
identity is ever authorized, how to preserve v1 bytes and exact FormRefs while
repairing forward. A changed response, route, or digest is never repaired by
overwriting an earlier identity.

## Inert boundary

This file is Markdown only. It performs no network request, credential read,
package installation, activation, apply, update, delete, or other Resource
mutation. It does not edit `spec/host-api/`, `spec/schemas/`, the Go client,
release ledgers, tags, routes, discovery, or package identities. It does not
mint, advertise, or publish `forms.takoform.com/v2` (or any other v2
schema/route/package/release identity), and it grants no promotion or deploy
authority. W19 remains an open proposal until the pending W12/W14/W17 evidence
and independent review close the gates.
