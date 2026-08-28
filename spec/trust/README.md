# Core trust profile

Takoform Core defines package identity, publisher-policy data, offline
signature verification, and append-only revocation verification. The
machine-readable contract is [`profile.json`](profile.json).

Publisher choice, installation, support, and activation remain caller or Host
decisions; Core consumes their exact policy and verification inputs.

## Package identity

`package-index.json` is UTF-8 I-JSON canonicalized with RFC 8785. Its identity
is `sha256:<lowercase hex>` over those canonical bytes. The index closes every
data payload by path, media type, size, and digest. An archive is only a
transport container and is not semantic package identity.

The verifier rejects duplicate object names, invalid Unicode, non-finite
numbers, negative zero, unlisted files, traversal, links, devices, executable
files, credentials, operator configuration, target/capacity/pricing data, and
executable validation or adapter code.

## Publisher policy

A publisher policy supplies exact values for:

- OIDC issuer;
- source repository;
- workflow identity; and
- protected ref.

The caller also supplies the trusted-root bytes, exact signed subject, Sigstore
bundle, and previous revocation pin. Core has no ambient trusted root, default
publisher, `official` field, privileged repository, or verification bypass.

The bundle is verified offline against the exact subject and publisher policy.
Verification requires its transparency-log inclusion evidence and fails closed
when the root, signature, issuer, source, workflow, ref, subject, or log proof
does not match.

The issued `BundleVerification` also carries three commits copied only from the
verified Fulcio certificate summary:

- `sourceCommit` is `SourceRepositoryDigest`, the exact source revision built;
- `workflowCommit` is `BuildSignerDigest`, the revision of the specific build
  instructions responsible for signing; and
- `buildConfigCommit` is `BuildConfigDigest`, the revision of the top-level
  initiating build instructions.

Each value is mandatory and must already be one non-null, lowercase 40-hex Git
commit digest. There is no caller-supplied fallback or normalization. Core
validates the three fields separately and does not require them to be equal.
Equality is a publisher/import policy decision: a reusable signing workflow can
make the specific signing instructions a different revision from the source or
calling workflow. Fulcio defines the three independent extension roles in its
[`OID directory`](https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md)
and maps GitHub's `sha`, `job_workflow_sha`, and `workflow_sha` claims to them
separately in its
[`GitHub CI issuer profile`](https://github.com/sigstore/fulcio/blob/main/config/identity/config.yaml).

An operator may trust multiple publishers, including a project-maintained one,
by installing multiple policies. Every policy traverses the same verifier and
produces the same report shape.

## Rotation and revocation

Publisher identity rotation is an explicit policy change. Existing package
bytes and their historical policy remain immutable.

A revocation statement names an exact package digest and FormRef. The current
statement and checkpoint data-format identity is
`trust.forms.takoform.com/v1`. It is a record format consumed by Core v1.1.0,
not another Host API lane or a third negotiated version axis. Current
statements use the exact stable, versionless FormRef schema. A checkpoint entry
records `statementApiVersion: trust.forms.takoform.com/v1`; Core derives its
other identity fields and digest only from an already-canonical, validated
statement, so the digest names the same RFC 8785 bytes that a publisher signs.

Every new current chain begins with this exact data document:

```json
{"apiVersion":"trust.forms.takoform.com/v1","checkpointVersion":"0.0.0","entries":[],"kind":"FormPackageRevocationCheckpoint","previousCheckpointDigest":null,"sequence":0}
```

This is the only empty checkpoint. `0.0.0` is reserved as its
`checkpointVersion` and is not a current `statementVersion`; every later
checkpoint has at least one entry, uses the final statement's version, and
carries the exact digest of its predecessor. Thus sequence one descends from
the signed genesis rather than starting a new chain with a null predecessor.

The document alone grants nothing. The publisher signs its exact canonical
bytes, and `VerifyRevocationCheckpoint` still requires the caller's exact
publisher policy, trusted root, Sigstore signature, transparency inclusion,
certificate provenance, and previous pin. Only that complete verification
issues the unforgeable capability consumed by `CheckNotRevoked`. A verified
genesis capability proves the publisher's signed current revocation set is
empty and can authorize `CheckNotRevoked` without inventing evidence. The
capability remains FormRef-profile-bound: a current checkpoint covers stable
versionless FormRefs, while a retained v1alpha1 checkpoint covers its Legacy
FormRef epoch. An empty current genesis cannot answer for the legacy chain.

A current verifier persists
`(checkpointApiVersion, sequence, checkpointDigest,
cumulativeEntriesDigest)` and accepts only the next checkpoint in that same
profile whose predecessor digest and complete retained prefix match the pin.
Rollback, omission, fork, prefix rewrite, and cross-profile advancement fail
closed. The caller stores that pin under the exact publisher policy that
verified it; a pin is not cross-publisher authority.

The occupied `trust.forms.takoform.com/v1alpha1` statement and checkpoint
schemas remain byte-exact readable history. Those chains begin at sequence one
with a null predecessor, and their historical pin JSON omits
`checkpointApiVersion`. They cannot be continued by a current v1 checkpoint or
used as an alias for the signed v1 genesis.

Security revocation blocks create, update, and activation. It does not replace
package bytes or erase existing Resources: referenced bytes remain available
for observe, delete, or an explicit operator evacuation path. Deprecation is a
different lifecycle fact.

## Use of verification results

Verification supplies caller and Host inputs; publication, Host installation,
support, activation, provisioning, client support, and a commercial Offering
remain separate decisions.

Host-side policy persistence and mutation ordering belong to the Host, outside
Core. Core provides deterministic formats and offline verification primitives.

Provider signing keys, Registry identities, provenance, and publication
workflows are external trust inputs, not Core defaults.
