# Future Specification and public-schema publication policy

This document owns the dormant owner-local choreography implemented by
[`scripts/specification-release.mjs`](../scripts/specification-release.mjs) and
its production adapter. It defines a possible future writer; it does not say
that the writer is active, that the first schema-origin authority cutover has
happened, or that a release after Specification 1.1 exists.

## Authority and the immutable P0 program

[`specification-authority.json`](specification-authority.json) is the sole
writer-authority record. P0 is the reviewed commit containing the disabled
program. Its direct authority-only child P records P0 as
`successorPreparedCommit`; the predecessor tombstone T pins P; and the direct
authority-only child A of P records the first transition to
`successor-active`. A also retains the separate, already completed first
schema-origin authority-cutover evidence. Commit identities are derived from
first-parent Git history, never self-recorded in the commit they identify.
Authority cannot return to prepared state after A.

P0 is the immutable execution root. The exact ordered transitive closure is
[`authority/specification-writer-closure.json`](authority/specification-writer-closure.json).
It includes the deploy interface, Specification writer and adapter, shared
record validator, still-transitive Core and schema-origin modules, package and
lock files, Wrangler configuration, policy, public keys, and the installed-tool
authority manifest. Before a credential, signer, package/source script, or
network-capable callback, the adapter compares the exact P0 Git blobs with the
loaded checkout at D, N, E, and current HEAD. Only after that local closure is
proved may it fetch a fresh canonical `main` and repeat the P0/D/N/E/current
blob and first-parent checks. `reserve`, `publish`, `recover`, receipt
preparation, receipt CAS, and verification all use this root.

A later executable change requires an explicit new authority rotation. D, N,
E, a later `main`, a recovery, or a receipt commit cannot update any file in
the P0 closure. This policy does not authorize such a rotation.

While authority is `prepared-writer-disabled`, every mutation entrypoint
(`reserve`, `apply-reservation`, `seal`, `prepare`, `publish`, `recover`,
`prepare-receipt`, `record`, and release `verify`) rejects before an adapter, signer, credential,
writer, or network callback is constructed or invoked. There is no CI writer,
ambient root/bypass authority, API-v2 writer, or separate privileged path for
an official publisher.

## Independent lanes and permanent identity fences

Publication has three closed lane selections:

- `specification` publishes the next unused Specification `1.x` minor. It has
  no schema reservation, no schema-origin candidate, no Wrangler/tool phase,
  no Cloudflare credential, and no Cloudflare mutation. Its N is exactly D.
- `schema` appends and deploys public schemas. Its candidate has null
  Specification version, title, track, Host lane, tag, source snapshot,
  GitHub Release, and receipt identity. It never reads tag/ruleset/GitHub
  authority and never creates a Specification tag or Release.
- `composed` performs both closed operations in schema-then-Specification
  order. Composition is convenience, not coupling between identities.

Specification 1.0 remains withdrawn and non-reusable. Specification 1.1 is
imported immutable history and cannot be recreated, retagged, rewritten, or
recorded again. A future Specification release is exactly the next unused
`1.x` minor. No operation may mint a Specification 2.x identity, Host API v2
lane, v2 public schema ID/path/route, v2 tag, v2 receipt, or v2 Release.

V2 design text is permitted only in `spec/proposals/**/*.md` with the exact
front matter `classification: non-normative-proposal`. The records gate scans
the complete `spec/` tree. Source-snapshot creation reads every exact D Git
blob, applies the same classifier, and records its classification and digest;
publish, recover, receipt, and verify recompute that snapshot from D and reject
different or newly minted v2 bytes. This does not reserve or announce a v2
public identity.

Schema publication is additions-only. Existing active and imported
verify-only entries retain exact ID, source, public path, and raw SHA-256;
those fields remain unique across both histories. Entries cannot move,
retire, reactivate, disappear, or be overwritten. New retirement is forbidden.
The only route is `forms.takoform.com/schemas/*`; retired and unknown schema
identities must read back as exact 404 without redirect.

## D to N to E

The public operation has no self-referential commit field:

1. **D — reviewed canonical bytes.** D is the reviewed canonical commit
   containing every normative Specification byte and every new schema source
   byte. `reserve` ignores caller-supplied entry objects and derives all and
   only unrecorded public schemas from the exact D tree. Each derived record is
   closed by canonical `$id`, source path, public path, and raw SHA-256.
2. **D to N — optional reservation.** With additions, `reserve` produces an
   unsigned reservation artifact without a signer, ref token, repository
   write, or network call. The isolated `seal` phase signs only its exact next
   record-head bytes. `apply-reservation` independently verifies the artifact
   and writes exactly the schema ledger, prefix chain, record head, and record
   signature. N is D's direct single-parent child changing exactly those four
   paths. With zero additions there is no seal or fake evidence: N is exactly
   D and the transition evidence is null.
3. **N to E — candidate only.** `prepare` reads the normative source snapshot
   from D and, only for a schema lane, the reservation state and opaque
   schema-origin candidate from N. E is N's direct single-parent child and its
   complete diff is the one create-only
   `release/specification-release-candidate.json` path. The candidate records
   D as canonical/normative commit and N as reservation commit.

An independent outside-repository review record is bound to the lane flags,
optional version, D, N, E, outer candidate digest, optional schema-origin
candidate digest, recovery flag, and fixed review topics. A mismatch blocks
credentials and mutation.

## Credential and process phases

The record-head signer and publication authorities are never present in the
same phase or process tree:

1. unsigned reservation or receipt preparation has no record signer or ref
   credential;
2. `seal` accepts only a closed unsigned artifact, the outside-repository
   signer command, a minimal sanitized environment, and the retained public
   key; it constructs no production adapter, reads no repository source, runs
   no package/build script, and invokes no network callback; and
3. reservation apply or receipt CAS verifies a sealed artifact and has no
   signer command or signer credential.

Every adapter invocation rejects non-empty off-phase authority at construction.
Reservation and Specification preparation accept no writer credential;
schema preparation may accept only explicit account/zone target IDs. Schema
publish/recover accepts only Cloudflare authority, Specification
publish/recover accepts only GitHub/tag/ruleset authority, receipt preparation
accepts only ruleset-audit authority, receipt CAS accepts only ruleset-audit
and ref-write authority, and verification accepts at most ruleset-audit
authority for a Specification lane. Operators invoke these as separate
processes rather than exporting the union declared by the deploy contract.

The signer is one absolute executable, non-symlink, non-writable ordinary file
outside the repository. Its only protocol is
`SIGNER sign --input FILE --output FILE`, returning exactly 64 raw Ed25519
bytes. The P0 program verifies those bytes against the independently retained
public key and pinned fingerprint. The signer environment contains only
minimal locale/path/temp values. Before invocation, the seal phase scans its
same-UID `/proc` ancestor chain and rejects GitHub, Cloudflare, tag-signing,
ruleset-audit, ref-write, agent, and proxy authorities. A signer-supplied key
has no authority.

Schema tool preparation is credential-free. The P0 package and lock blob IDs
and the P0
[`authority/specification-schema-tool-closure.json`](authority/specification-schema-tool-closure.json)
pin the supported OS/architecture, the absolute non-writable Node executable,
its version and SHA-256, Wrangler version and executable, complete installed
closure file count, and canonical path/digest/executable-bit manifest
SHA-256. The adapter copies and dereferences only internal `node_modules`
files into an isolated read-only runtime, verifies source before and after
copying, and verifies the copy against the P0 manifest. It supplies only the
sealed closure as `NODE_PATH`, rehashes the sealed closure before reading
Cloudflare authority and again immediately before each Wrangler spawn, and
revalidates the pinned Node runtime at that same just-in-time boundary. It
independently walks the sealed root on every check: directories are owned by
root or the current user with mode `0555`, and every file is an owned,
single-link `0444` or executable `0555` regular file. It never installs
dependencies or runs source, package, lifecycle, build, or
mutable `node_modules` scripts while a publication credential is available.
The schema-origin deploy owner must consume equivalent sealed-tool evidence
rather than execute a mutable install with Cloudflare authority.

## Publication, receipt, and recovery

Schema publication first proves exact pre-route 200/404 state, prepares the
sealed tool closure, stages the reviewed candidate create-only, verifies its
annotations, activates only its exact Worker version, and performs complete
credential-free schema/404 readback. A Specification lane separately proves
the tag and Release absent, audits the one exact active no-bypass tag ruleset,
creates a signed annotated `specification/1.x` tag at E, re-audits, and makes
one direct create-only immutable, non-draft, non-prerelease GitHub Release with
an exact body and no assets. It never PATCHes or deletes an identity.

Receipt recording is three explicit operations. `prepare-receipt` re-reads the
exact live publication and emits unsigned ledger/prefix/head bytes without a
record signer or ref token. `seal` signs only those head bytes. `record`
accepts the sealed artifact and no signer. Inside the final CAS callback it
immediately re-reads the exact signed tag, immutable empty Release, and exact
no-bypass ruleset before its first ref-token read. Only then does it fetch a
fresh canonical parent, prove E ancestry and unchanged P0 execution and four
record blobs, construct one sole-parent receipt commit changing exactly the
Specification ledger, prefix chain, record head, and signature, and push with
an exact `--force-with-lease` from that parent. Drift reads zero ref tokens and
causes zero pushes. A lost lease is freshly classified and retried only while
E ancestry and all four E blobs remain exact; publication is never replayed.

The GitHub tag/Release/ruleset reads and leased Git ref push are not one atomic
transaction. A change after the final fence can leave a non-atomic residual;
the authoritative post-push classification detects it and requires explicit
forward repair. It is not represented as rollback or silent success.

Recovery is forward-only and uses the same P0 closure and an independently
reviewed `recovery: true` record. It classifies exact state and performs only a
missing forward step. Mixed schema state, duplicate/mismatched stages,
ambiguous HTTP results, mismatched tags/releases/rulesets, or a Release without
its exact tag halt for operator inspection. It never reopens the predecessor,
reissues 1.1, deletes an identity, or turns a schema-only operation into a
Specification release.

After activation, `verify` is read-only. It closes authority, P0/D/N/E/current blobs, the optional
D-to-N edge, direct N-to-E candidate edge, append-only ledgers and signed head,
optional live schema state, exact tag/ruleset/Release, and the descendant
receipt lineage. Later canonical commits are acceptable only while the receipt
remains on first-parent history and its four record blobs remain exact.
