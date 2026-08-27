# Core trust profile

Takoform Core defines package identity, publisher-policy data, offline
signature verification, and append-only revocation verification. It does not
choose a publisher for an operator and does not install, support, or activate a
Form.

The machine-readable contract is [`profile.json`](profile.json).

## Package identity

`package-index.json` is UTF-8 I-JSON canonicalized with RFC 8785. Its identity
is `sha256:<lowercase hex>` over those canonical bytes. The index closes every
data payload by path, media type, size, and digest. An archive is only a
transport container and is not semantic package identity.

The verifier rejects duplicate object names, invalid Unicode, non-finite
numbers, negative zero, unlisted files, traversal, links, devices, executable
files, credentials, operator configuration, target/capacity/pricing data, and
executable validation or adapter code.

## Caller-supplied publisher policy

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

An operator may trust multiple publishers, including a project-maintained one,
by installing multiple policies. Every policy traverses the same verifier and
produces the same report shape.

## Rotation and revocation

Publisher identity rotation is an explicit policy change. Existing package
bytes and their historical policy remain immutable.

A revocation statement names an exact package digest and FormRef. Checkpoints
are cumulative and hash-chained from sequence 1. A verifier persists
`(sequence, checkpointDigest, cumulativeEntriesDigest)` and accepts only the
next checkpoint whose previous digest and complete retained prefix match that
pin. Rollback, omission, fork, and prefix rewrite fail closed.

Security revocation blocks create, update, and activation. It does not replace
package bytes or erase existing Resources: referenced bytes remain available
for observe, delete, or an explicit operator evacuation path. Deprecation is a
different lifecycle fact.

## Lifecycle boundary

Cryptographic verification is not publication. Publication is not Host
installation. Installation is not support. Support is not activation.
Activation is not provisioning, client support, or a commercial Offering.

Host-side policy persistence and mutation ordering belong to the Host, outside
Core. Core provides only deterministic formats and offline verification
primitives; no roadmap work package is a current trust requirement.

Provider signing keys, Registry identities, Provider provenance, and official
or third-party publication workflows belong to their owning repositories and
are not Core trust defaults.
