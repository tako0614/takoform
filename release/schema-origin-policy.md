# Takoform Core schema-origin staging and cutover policy

This policy governs the one-time owner-operated move of the existing public
schema bytes to the Core-owned static-assets Worker. It does not publish a new
schema identity, enable the general Specification/schema writer, deploy a Host
API, or create an API v2 surface.

## Exact surface

The only permitted target is:

- account: explicitly captured in the outside-repository candidate;
- zone: `takoform.com`, at the candidate's exact zone ID;
- Worker: `takoform-schema-origin`;
- route: `forms.takoform.com/schemas/*`;
- assets: the closed active projection in `schema-origin/public`;
- pinned deploy client: repository-local Wrangler `4.115.0`, executed by the
  exact non-writable Node runtime recorded in
  `authority/specification-schema-tool-closure.json`.

The tool permanently refuses another hostname, path, zone name, Worker,
route, `/v2` identity, redirect, partial 2xx response, retired projection,
duplicate record, or ambiguous route/domain/version/deployment state. It does
not use `bunx`, an ambient Wrangler installation, a custom API base URL, API
keys, or email/key authentication. Every control-plane read or mutation uses
the explicit `CLOUDFLARE_API_TOKEN`; the token is never an argument, record, or
diagnostic value.

Every Wrangler child receives a newly isolated `HOME`, `XDG_CONFIG_HOME`,
`XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and temporary directory.
Its environment is rebuilt from a minimal allowlist; the parent environment is
not copied. In particular, `NODE_OPTIONS`, debug flags, proxy/no-proxy values,
custom CA locations, Cloudflare API-base overrides, ambient Cloudflare
credentials, and ambient Wrangler config/log paths cannot cross the subprocess
boundary. Wrangler stdout and stderr are token-redacted. Determinate
pre-mutation failures remove the temporary child state. If an external
mutation has begun or readback is indeterminate, the tool instead retains a
bounded operator-private recovery artifact outside the repository: sanitized
command/status/signal/stdout/stderr, machine output, the `0600` machine-output
file, `0700` diagnostic and execution roots, and the `0555` sealed closure.
The artifact contains no token and is retained until authoritative readback
and any forward repair are complete; only then may an operator remove the
exact paths named by `recoveryEvidence` (never a broad temporary directory).

The initial byte closure is exactly 31 active JSON URLs and 155294 bytes. Each
must return status `200`, exact `Content-Type: application/json`, and its
ledger-locked body digest. All 15 verify-only/retired URLs and the fixed unknown
URL must remain exact `404`. A caller-selected, canonical non-schema URL on
`https://forms.takoform.com` is captured as the sentinel and must remain exact
`200` with unchanged status, content type, length, and body digest.

Before staging, the `takoform.com` zone route list must be exactly empty. The
zone custom-domain closure must contain only `takoform.com`,
`www.takoform.com`, and `forms.takoform.com`, each owned by
`takoform-website` with the candidate's exact IDs. The new Worker must be
absent. Any drift blocks the operation; it is not reconciled by this tool.

## Records and invocation authority

`scripts/schema-origin-deploy.mjs` is an owner-local delegate. CI and GitHub
Actions must not invoke it. A green repository check, task, branch name,
candidate, review record, proposal, or stage record does not grant production
authority. The operator separately decides whether to invoke a read or
mutation. Normal discovery and proposal preparation go through the single
credentialless `bun run deploy` facade; this delegate and the sealed runner are
not direct operator entrypoints.

The facade is started exactly as `/usr/bin/env -i /usr/local/bin/bun run deploy
-- ...`. It rejects credentials and runtime startup/loaders, `LD_*`, `DYLD_*`,
`__XPC_DYLD_*`, custom CA, proxy, shell-startup, Git-override, and key-agent
inputs before module work. Every phase that uses `CLOUDFLARE_API_TOKEN`,
including authenticated `verify`, first uses the same credentialless facade to
produce a sealed proposal and unsigned review request. Public-only `verify`
runs directly with the empty facade environment.

`--continuation-review` supplies the canonical earlier source/broker review v1
record. It includes an independently computed digest of exact
`git ls-tree -r -z --full-tree S` bytes. Credentialless proposal preparation
computes the same digest independently and refuses a mismatch. Its digest is
sealed into the proposal. A dedicated outside-repository
reviewer then approves the exact `takoform.sealed-deploy-review@v2` request and
signs its canonical bytes with the pinned Ed25519 authority in SSHSIG namespace
`takoform-sealed-continuation-review-v2`. Repository tooling never reads the
review private key. Only the independently reviewed, preinstalled root-owned
static broker verifies this signature and all proposal/source/closure/runtime/
broker/launcher/invocation identities. It accepts unprivileged-producer input
custody, copies the reviewed source and phase inputs into a new root-owned
private execution root, reseals and revalidates the exact closure digests, and
executes only that immutable copy. The signed review explicitly binds `S`, the
source-review digest, the matching raw-tree digest, and both closure digests.
The broker verifies those signed equalities and original/resealed content but
does not run Git or interpret Git objects itself. Only after this reseal does it atomically
mint and consume its internal one-use capability, refuse replay, and read canonical
`{"CLOUDFLARE_API_TOKEN":"..."}` bytes from protected FD 3.

The broker remains the sealed runner's live parent. Source JavaScript receives
only an unlinked root-owned minimal broker-attested run request on child FD 3
and the exact credential envelope on child FD 4, never the capability or nonce.
The runner verifies the live broker path, digest, device, inode, owner, mode,
and parent start time before reading FD 4. The token is never passed through
Bun, the normal checkout, argv, ambient environment, proposal, signed review,
run request, or diagnostics. Proposal output is structured non-secret argv
components, not a copy-paste shell command.

The credentialed continuation must make the installed static broker the first
new executable to inherit FD 3. A trusted operator launcher or credential
broker creates the empty environment before it attaches the FD; `/usr/bin/env`,
Bun, Node, package scripts, and other dynamic wrappers must not sit between
that point and the broker. The static broker can safely reject an accidentally
non-empty environment without honoring `LD_*` or `DYLD_*` loader injection.
While it owns the unread FD it uses only in-process static parsing, hashing,
and filesystem checks and starts no child or source parser. After reseal,
atomic consume, and credential read, Node is the sole executable the broker
starts. Git and `ssh-keygen` are separately reviewed continuation-tool
identities; Bun is recorded only as credentialless preparation evidence here,
because schema proposal preparation performs the frozen install.

Candidates, independent reviews, tombstone readbacks, stage records, cutover
records, activation evidence, revert records, and sanitized operator
diagnostics are production records.
They must use absolute paths outside the repository. The tool creates records
mode `0600`, refuses symlinks and existing outputs, and never overwrites a
record. They and `CLOUDFLARE_API_TOKEN` must not be committed.

The strict sequence is:

```text
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /absolute/operator-records/prepare.continuation --source COMMIT --continuation-review /absolute/operator-records/continuation-review.json -- takoform-schema-origin prepare \
  --expected-commit COMMIT \
  --account-id ACCOUNT_ID \
  --zone-id ZONE_ID \
  --sentinel-url https://forms.takoform.com/ \
  --output /absolute/operator-records/schema-origin-candidate.json

/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /absolute/operator-records/stage.continuation --source COMMIT --continuation-review /absolute/operator-records/continuation-review.json -- takoform-schema-origin stage \
  --expected-commit COMMIT \
  --candidate /absolute/operator-records/schema-origin-candidate.json \
  --review-record /absolute/operator-records/schema-origin-review.json \
  --output /absolute/operator-records/schema-origin-stage.json

/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /absolute/operator-records/cutover.continuation --source COMMIT --continuation-review /absolute/operator-records/continuation-review.json -- takoform-schema-origin cutover \
  --expected-commit COMMIT \
  --candidate /absolute/operator-records/schema-origin-candidate.json \
  --stage-record /absolute/operator-records/schema-origin-stage.json \
  --predecessor-tombstone-commit TOMBSTONE_COMMIT \
  --predecessor-readback /absolute/operator-records/predecessor-tombstone-readback.json \
  --output /absolute/operator-records/schema-origin-cutover.json

/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /absolute/operator-records/prepare-activation.continuation --source COMMIT --continuation-review /absolute/operator-records/continuation-review.json -- takoform-schema-origin prepare-activation \
  --expected-commit COMMIT \
  --candidate /absolute/operator-records/schema-origin-candidate.json \
  --stage-record /absolute/operator-records/schema-origin-stage.json \
  --cutover-record /absolute/operator-records/schema-origin-cutover.json \
  --cutover-record-sha256 sha256:EXACT_CUTOVER_RECORD_DIGEST \
  --predecessor-tombstone-commit TOMBSTONE_COMMIT \
  --predecessor-readback /absolute/operator-records/predecessor-tombstone-readback.json \
  --output /absolute/operator-records/schema-origin-activation.json

/usr/bin/env -i /usr/local/bin/bun run deploy -- takoform-schema-origin verify \
  --candidate /absolute/operator-records/schema-origin-candidate.json
```

Each `--prepare-sealed-continuation` line creates only the private proposal and
returns structured broker data; it does not execute the named phase or mint an
accepted capability. After external review and signature, the operator invokes
the returned exact broker argv components with review/signature paths and FD 3
populated as described above. No caller-controlled path is concatenated into a
shell command. The broker binds exact surface/phase/source and sealed phase
inputs, consumes once before reading the credential, and refuses replay.

The facade does not rerun an owner gate while producing the proposal. The
schema-origin phase itself performs its documented fresh source, public, and
control-plane gates after the broker has authorized that exact invocation.
`prepare` is the read-only pre-mutation proof; later stage/cutover/activation/
revert proposals recursively bind the exact candidate, review, stage, cutover,
and predecessor evidence named by their phase.

`prepare`, `stage`, `cutover`, `prepare-activation`, and `revert` require a fresh, clean,
non-shallow, attached `main` checkout whose `HEAD`, canonical `origin/main`, and
the requested commit are identical. The origin must be exactly
`https://github.com/tako0614/takoform.git`; Git replacements, object
alternates, a dirty tree, and an unpinned local Wrangler are rejected.

## Prepare: read-only pre-mutation proof

Prepare performs no Cloudflare mutation. Its only write is the requested
outside-repository candidate. It requires Core authority to remain
`prepared-writer-disabled` and already pin the exact P0 prepared commit. It
captures:

- exact canonical Core `main` commit and authority-record digest;
- schema ledger, active projection, and Wrangler config digests;
- the complete 31-URL source/projection/body-digest/byte inventory;
- the complete 15-URL retired inventory and fixed unknown URL;
- public active, retired, unknown, and non-schema sentinel readbacks;
- exact empty route, predecessor custom-domain, and absent-Worker preflight;
- a closed dry-run bundle built by local Wrangler `4.115.0`.

The dry run is `wrangler versions upload --dry-run` to an outside temporary
directory under the validated Node runtime. It neither authenticates nor uploads. Every ordinary output file,
length, and SHA-256 digest enters the candidate closure.

## Independent review

Stage requires a canonical outside-repository JSON record of kind
`takoform.schema-origin-independent-review@v1`. It must set `approved: true`,
name a non-empty reviewer and canonical UTC `reviewedAt`, and bind the exact
source commit and complete candidate-file SHA-256. Its `reviewed` array is
exactly:

```json
[
  "candidate-and-source-closure",
  "predecessor-disable-before-cutover-order",
  "public-byte-and-sentinel-readback",
  "route-custom-domain-and-version-state",
  "stage-without-trigger-and-exact-reversal"
]
```

Missing, reordered, duplicated, additional, stale, or non-canonical review
evidence blocks before the first external mutation.

## Stage: version and deployment, no route

Stage revalidates the candidate against fresh local, public, route,
custom-domain, and absent-Worker evidence. Only then may it use explicit
operator authentication.

It invokes local Wrangler in this order:

1. `versions upload --strict` with the exact config, Worker name, source commit,
   and candidate digest in the version message;
2. API readback of that exact version, while proving the route remains absent;
3. `versions deploy VERSION_ID@100% --yes` with an exact deployment message;
4. API readback proving that the latest deployment contains only that version
   at 100%, while proving the route and custom domains remain unchanged.

Stage never invokes `wrangler deploy`, `wrangler triggers deploy`, a route API
write, or custom-domain write. Version upload and 100% deployment are external
mutations even though customer traffic remains on the predecessor custom
domain. A stage failure is not retried blindly and the Worker, version,
deployment, or assets are not deleted automatically.

## Cutover: predecessor disabled first, one exact trigger

Cutover is permitted only while local Core authority is still
`prepared-writer-disabled`. It does not edit the authority record and reports
`specificationWriterActivated: false`.

Before the route mutation, the operator supplies a canonical record of kind
`takoform.schema-origin-predecessor-tombstone-readback@v1`. It must bind the
exact canonical predecessor `main` tombstone commit, this candidate's exact
successor commit, `writerState: "disabled"`, a disable instant strictly before
the readback instant, and this exact `checks` array:

```json
[
  "canonical-main-is-tombstone",
  "predecessor-schema-writer-disabled",
  "predecessor-specification-writer-disabled",
  "successor-prepared-commit-pinned"
]
```

The tool independently reads canonical predecessor `main` and requires the
same commit. A zero-writer interval is valid; dual writers and route cutover
before disablement are forbidden.

Immediately before mutation, cutover repeats the old 31-byte closure,
retired/unknown 404s, sentinel, exact empty route, exact predecessor custom
domains, and exact staged version/deployment at 100%. It then invokes only
local Wrangler `triggers deploy` against the already closed config. That config
contains one path route and no custom domain, cron, binding, runtime, redirect,
or other trigger.

Post-conditions are all mandatory:

- the zone route list contains exactly one record with the returned route ID,
  pattern `forms.takoform.com/schemas/*`, and script
  `takoform-schema-origin`;
- the three predecessor custom domains are unchanged;
- all 31 active public bytes and content types are exact;
- all retired and unknown URLs remain 404;
- the non-schema sentinel is byte-exact and unchanged;
- the staged version/deployment remains the sole current 100% deployment;
- general Specification writer authority remains disabled.

The cutover record has a canonical `completedReadbackAt` strictly after the
predecessor tombstone readback. It includes the exact route ID/pattern/script,
custom domains, public and schema-count closure, version, deployment, Worker
state, and SHA-256 closure over the candidate, stage record, predecessor
readback, ledger, projection, config, dry-run bundle, 31-active inventory,
15-retired inventory, public readback, route, domains, version, deployment, and
Worker state. Missing, additional, or changed closure fields fail closed.

Failure of a post-condition is a failed cutover, not permission to activate the
Specification writer.

## Prepare activation: fresh evidence immediately before A

`prepare-activation` is read-only with respect to Cloudflare and the repository.
Its only write is the requested canonical evidence file outside the repository.
The caller must supply the exact expected cutover-record SHA-256. Before
accessing `CLOUDFLARE_API_TOKEN` or calling a control-plane or signer
capability, the tool requires the local canonical source P and authority state
to remain exactly `prepared-writer-disabled` and to match the candidate.

It then revalidates all of the following immediately before authority commit A:

- source P, candidate digest, stage-record digest, cutover-record digest, and
  predecessor-readback digest;
- exact predecessor tombstone T and a fresh read of canonical predecessor
  `main` at T;
- cutover route ID, pattern, script, and an exact sole live zone route;
- all 31 active URLs and 155294 bytes, all 15 retired URLs plus the fixed
  unknown URL at 404, and the byte-exact non-schema sentinel;
- unchanged predecessor custom domains;
- the exact staged version, deployment, and sole 100% Worker state.

Fresh closure must equal the closed cutover record. The evidence records a
canonical `freshReadbackAt`, then proposes a canonical
`successorWriterEnabledAt` strictly after that readback and predecessor
disablement. The proposed authority object is the existing prepared receipt
with only these authority-transition fields changed:

```json
{
  "state": "successor-active",
  "predecessorTombstoneCommit": "T",
  "successorPreparedCommit": "P0_FROM_PREPARED_RECEIPT",
  "schemaRouteCutover": {
    "format": "takoform.schema-origin-authority-cutover@v1",
    "sourceCommit": "P",
    "predecessorTombstoneCommit": "T",
    "candidateSha256": "EXACT_CANDIDATE_DIGEST",
    "stageRecordSha256": "EXACT_STAGE_RECORD_DIGEST",
    "cutoverRecordSha256": "EXACT_CUTOVER_RECORD_DIGEST",
    "predecessorReadbackSha256": "EXACT_TOMBSTONE_READBACK_DIGEST",
    "routeId": "EXACT_ROUTE_ID",
    "routePattern": "forms.takoform.com/schemas/*",
    "worker": "takoform-schema-origin",
    "versionId": "EXACT_VERSION_ID",
    "deploymentId": "EXACT_DEPLOYMENT_ID",
    "completedReadbackAt": "CUTOVER_COMPLETED_READBACK",
    "freshReadbackAt": "ACTIVATION_FRESH_READBACK",
    "closureSha256": "DIGEST_OF_THE_PRECEDING_14_FIELDS"
  },
  "predecessorWriterDisabledAt": "TOMBSTONE_DISABLED_AT",
  "successorWriterEnabledAt": "STRICTLY_AFTER_FRESH_READBACK"
}
```

The tool computes `schemaRouteCutover.closureSha256` only through the exported
records-layer `schemaRouteCutoverClosureSha256` helper. The object has exactly
the 15 fields above. The activation evidence embeds that same exact object,
and its activation closure separately hashes the canonical object so neither
copy can drift from the active authority receipt.

All other authority fields, including cutoff/release identity,
`writerOverlapAllowed: false`, and the forward-only rollback text, remain
byte-for-byte equivalent as JSON values. The full object is
`evidence.authority`; `evidence.authoritySha256` closes its canonical bytes.
`activationChange.parentCommit` is exactly source P and
`activationChange.changedPaths` is exactly
`["release/specification-authority.json"]`, both `externalMutation` and
`apiV2Mutation` are false, and `activationChange.notBefore` equals the proposed
enable instant.

A is a later, separately reviewed direct child of that parent P and an
authority-only commit that copies exactly
`evidence.authority` into `release/specification-authority.json`. It must not be
created before `activationChange.notBefore`, change any other path, invoke a
credential/signer before the prepared-state fence, mutate Cloudflare, activate
an API v2 surface, or rerun cutover. The evidence itself does not enable the
writer; after A is canonical, the successor owns forward repair and route
revert is forbidden. All activation evidence remains outside the repository.

## Verify: public-only by default

Verify is read-only. With no `CLOUDFLARE_API_TOKEN`, it reads only the candidate
and public URLs; it does not require a repository, Wrangler, account, route, or
mutation capability. Its result explicitly says that only public bytes were
closed.

When an explicit token is present, verify additionally requires the exact sole
route and unchanged custom-domain closure. Verify never mutates either state.
Authenticated verification is prepared explicitly; an ambient token on the
public command is rejected:

```text
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /absolute/operator-records/authenticated-verify.continuation --source COMMIT --continuation-review /absolute/operator-records/continuation-review.json -- takoform-schema-origin verify \
  --candidate /absolute/operator-records/schema-origin-candidate.json
```

## Revert before successor activation

Revert is an explicit, operator-authorized emergency action and is allowed only
while Core authority remains `prepared-writer-disabled`:

```text
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /absolute/operator-records/revert.continuation --source COMMIT --continuation-review /absolute/operator-records/continuation-review.json -- takoform-schema-origin revert \
  --expected-commit COMMIT \
  --candidate /absolute/operator-records/schema-origin-candidate.json \
  --route-id EXACT_ROUTE_ID \
  --script takoform-schema-origin \
  --output /absolute/operator-records/schema-origin-revert.json
```

The tool first requires the zone route list to contain only the supplied exact
ID, exact pattern, and exact script. It issues one Cloudflare API `DELETE` for
that route ID. It never deletes or changes the Worker, version, deployment,
assets, custom domains, or predecessor Worker. It then proves the route list is
exactly empty, the three predecessor custom domains are unchanged, all old 31
schema bytes are again reachable through fallback, retired/unknown remain 404,
and the sentinel is unchanged.

After authority becomes `successor-active`, revert is permanently refused even
if the route is unhealthy. Recovery then requires a reviewed forward repair in
Core; the predecessor writer is never reopened.

## Obligations and failure handling

- **Provenance:** the clean canonical commit, authority/ledger/projection/config
  digests, closed dry-run bundle, public bytes, and exact Wrangler/API readbacks
  bind every mutation to one reviewed candidate.
- **Independent review:** the exact external review record is mandatory before
  version upload. The exact independent tombstone readback is mandatory before
  route cutover.
- **Post-conditions:** route, version/deployment, all active and negative URLs,
  custom domains, and non-schema traffic are read back after mutation.
- **Reversal:** before successor activation, delete only the exact route and
  prove predecessor fallback. After activation, repair forward.
- **Failure handling:** every error reports phase, stage, whether external state
  is known touched, and whether the outcome is indeterminate. A failure before
  a mutation reports untouched. A transport failure after a mutation request
  begins reports indeterminate. A completed mutation followed by a definite
  failed fence reports touched. There is no automatic cleanup, destructive
  recovery, or blind retry.

An indeterminate result requires operator inspection of the retained sanitized
outside-repository recovery artifact and fresh authoritative readback before
choosing a new action. The retained machine output and sealed/execution
evidence remain private, bounded, token-redacted, and mode/ownership checked
until that inspection completes; they are then removed by exact path after
the operator confirms no further recovery is needed. Re-running the same
mutating phase is not a recovery protocol.
