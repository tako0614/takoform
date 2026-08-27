# Takoform Core release policy

This repository owns `github.com/tako0614/takoform@v0.1.0`, titled
`Takoform Core v0.1.0`, and the versioned commands `form-package`,
`generic-conformance`, and `takoform-trust`. The distribution is the Go module;
the immutable GitHub Release has `assets: []`. This release has no Host API v2
effect.

Publication is an operator action through the single owning `bun run deploy`
surface. The exact credentialless outer invocation is
`/usr/bin/env -i /usr/local/bin/bun run deploy -- ...`; Bun and the normal
checkout never inherit release authority. CI does not mutate a release. `--contract` is
credentialless and side-effect free. A green portable gate, task, branch, or
review record is evidence, not publication authority.

## Seven phases and one brokered authority class

Each phase is a separate process. Credentialless `prepare`, `record-prepare`,
and `verify` run through the clean facade. An authority phase begins with a
second credentialless facade invocation that produces only a private proposal
and an unsigned review request. The proposal binds exact surface, phase,
reviewed source `S`, recursively sealed phase inputs, closure inventory, an
independently computed raw Git tree digest, continuation-runtime and
static-broker identities, a prior source/broker review, and a random nonce.
Source JavaScript cannot mint an accepted capability and cannot execute an
authority phase directly.

The dedicated independent reviewer turns that exact review request into a
canonical `takoform.sealed-deploy-review@v2` record and signs its exact bytes
with SSHSIG namespace `takoform-sealed-continuation-review-v2`. The signing key
is operator-held and is never read, copied, or logged by repository tooling.
Only the separately built, independently reviewed, preinstalled root-owned
static broker accepts that signature. The proposal and its inputs may remain
owned by the unprivileged credentialless producer. After signature and content
verification, the broker copies them into a new root-owned private execution
root, reseals and revalidates the exact closure manifest/tree and raw `S`, and
refuses any mutation. Git commit-to-tree interpretation is part of the
independent review, not broker code: the source review records the exact
`git ls-tree -r -z --full-tree S` digest, and proposal preparation independently
recomputes and refuses a mismatch. The signed v2 review explicitly binds `S`,
that source-review digest, the same raw-tree digest, and both closure digests.
The broker checks those signed equalities and every original/resealed byte,
but runs no Git or other parser child for them. It executes only the resealed
copy. It then atomically mints and
consumes one internal one-use capability, records replay state, and only after
both reseal and consume reads the phase's one aggregate credential envelope
from protected FD 3. A crash or replay needs a newly reviewed proposal.

The broker remains the supervising parent and starts the sealed Node runner
with an empty environment. It passes a minimal unlinked root-owned
`takoform.broker-attested-run-request@v1` on child FD 3 and the exact credential
object on child FD 4. The runner independently verifies the live parent PID,
executable digest and filesystem identity before it reads FD 4. The internal
capability and nonce never reach source JavaScript. Credential bytes are never
in Bun, the normal checkout, argv, ambient environment, proposal, signed
review, run request, replay marker, or diagnostics.

For the credentialed continuation, the static broker must be the first new
executable that inherits credential FD 3. Do not wrap that invocation in
`/usr/bin/env`, Bun, Node, a package script, or another dynamic executable after
the FD is attached. The trusted operator launcher or credential broker must
create the empty environment before attaching the protected FD. The static ELF
broker is safe to start far enough to reject any accidentally non-empty
environment without honoring `LD_*`/`DYLD_*` loaders, but rejection is not an
excuse to expose the FD to an earlier dynamic wrapper. While it owns the unread
operator FD, the broker performs only in-process static parsing, hashing, and
filesystem checks. It refuses to start Git, Bun, Node, `ssh-keygen`, a source
parser, or any other child until after reseal, atomic consume, and credential
read. Node is the sole executable the broker itself starts.

```text
/usr/bin/env -i /usr/local/bin/bun run deploy -- takoform-core-release prepare --expected-commit S --output /private/qualification.json
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /private/audit.continuation --source S --continuation-review /private/continuation-review.json -- takoform-core-release audit --expected-commit S --ruleset-id ID --output /private/ruleset-audit.json
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /private/sign.continuation --source S --continuation-review /private/continuation-review.json -- takoform-core-release sign-tag --expected-commit S --qualification /private/qualification.json --ruleset-audit /private/ruleset-audit.json --review-record /private/review.json --output /private/tag-bundle.json
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /private/publish.continuation --source S --continuation-review /private/continuation-review.json -- takoform-core-release publish --expected-commit S --qualification /private/qualification.json --ruleset-audit /private/ruleset-audit.json --review-record /private/review.json --tag-bundle /private/tag-bundle.json --mode forward
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /private/recover.continuation --source S --continuation-review /private/continuation-review.json -- takoform-core-release publish --expected-commit S --qualification /private/qualification.json --ruleset-audit /private/ruleset-audit.json --review-record /private/review.json --tag-bundle /private/tag-bundle.json --mode recover
/usr/bin/env -i /usr/local/bin/bun run deploy -- takoform-core-release record-prepare --expected-commit S --output /private/record-push
/usr/bin/env -i /usr/local/bin/bun run deploy -- --prepare-sealed-continuation /private/record-push.continuation --source S --continuation-review /private/continuation-review.json -- takoform-core-release record-push --artifact /private/record-push
/usr/bin/env -i /usr/local/bin/bun run deploy -- takoform-core-release verify --expected-commit S --receipt-commit R
```

`--continuation-review` names the earlier canonical source/broker review v1
record. It binds raw reviewed `S` and the exact installed broker digest. Its
canonical fields also include the independently computed raw source-tree
digest. Proposal preparation computes that digest again and refuses any
mismatch. The source-review digest, `S`, raw-tree digest, closure-manifest
digest, and closure-tree digest become explicit inputs to the later signed v2
broker review. Both reviews are distinct from the Core publication review consumed by
`sign-tag`, which binds the qualification and publication-time ruleset audit
that do not exist at proposal-bootstrap time.

Each `--prepare-sealed-continuation` invocation only prints structured,
non-secret broker data: the exact executable, an argv prefix containing the
proposal path and digest, the review and signature flag names, and credential
FD 3. It emits no shell command, credential, or source-minted capability. The
operator completes the canonical review v2 record, signs it in the pinned
namespace outside repository tooling, appends the review/signature paths to the
structured broker argv, and supplies exact canonical credential JSON on FD 3.
No caller-controlled path is interpolated into a shell command. The JSON keys
are the phase's exact names in the table below. The tag private key is exposed
to the sealed phase only as an ephemeral file, whose inode and custody are
checked before it is unlinked in `finally` on success or failure.

The facade does not claim to rerun every phase's owner gate. Core `prepare`
alone runs the source lifecycle and complete owner gate. Later proposals seal
the exact prerequisites their phase consumes: `sign-tag` and `publish` bind
qualification/audit/review/tag inputs, while `record-push` recursively binds
the directory emitted by credentialless `record-prepare`. `audit` is a
read-only authenticated GET bound to reviewed `S` and its two reviews.

| Phase | Sole allowed authority | Purpose |
| --- | --- | --- |
| `prepare` | none | Source lifecycle, gate, deterministic double-build, and local command qualification |
| `audit` | `GH_TOKEN` | One authenticated exact tag-ruleset `GET` |
| `sign-tag` | `TAKOFORM_CORE_TAG_SIGNING_KEY` | Create the SSH-signed annotated tag object |
| `publish` | `GH_TOKEN` | Create only a missing exact tag and/or immutable asset-free Release |
| `record-prepare` | none | Fresh public verification and construction of the one-ledger-path `P -> R` artifact |
| `record-push` | `TAKOFORM_CORE_REF_WRITE_TOKEN` | Exact main compare-and-swap and authoritative Git readback |
| `verify` | none | Fresh public verification against recorded `R` |

GitHub does not expose `bypass_actors` to a truly read-only repository token.
The `GH_TOKEN` used by `audit` is therefore mutation-capable at the platform
level even though that invocation performs only the exact `GET`. `audit` and
`publish` may use the same token in separate invocations. Tag-signing and
main-ref authority remain separate.

## Trust boundary

The normal `bun run deploy` surface is always credentialless. Bun starts the
exact Node facade only inside an empty environment and remains a child tool for
`prepare` install/check work; Bun is never a credentialed parent runtime. The
sealed tool binding uses the resolved non-writable executable
`/usr/local/lib/node_modules/bun/node_modules/@oven/bun-linux-x64-baseline/bin/bun`,
not the mutable meaning of an ambient `bun` or `PATH` lookup. The
credentialed trust boundary begins at the preinstalled static broker
`/usr/local/libexec/takoform-sealed-deploy-broker`, described by
`release/authority/core-release-broker.json`: its exact executable, Go build
ID, root ownership, non-writable mode, static ELF shape, installed review trust
root, and private replay-state root are operator-verified installation facts.
Repository source contains the build and verification contract but does not
install the broker or claim an unrealized production digest.

The proposal records Git as a credentialless preparation tool. It records Bun
as preparation-only evidence only for surfaces whose proposal actually runs a
frozen install; Core proposal preparation does not. The brokered runtime
closure separately records Node and the exact Git/`ssh-keygen` dependencies
that reviewed continuation code may invoke. This classification does not turn
those tools into broker children: the static broker itself starts only Node,
and only after the pre-credential no-child boundary above.

The declared execution boundary is source code at reviewed commit `S` plus
absolute, resolved system executables that are regular files, are owned by root
or the current user, and are not group/world writable. The tool records retain
each resolved path, binary digest, and version probe in operator-private
evidence. Privileged Git and `ssh-keygen` calls never resolve from ambient
`PATH`; Git SSH signing and verification set an absolute `gpg.ssh.program`.
Child environments discard ambient credential helpers and Git overrides.

The owning deploy facade and sealed Core release runner use the exact
`/usr/local/bin/node` runtime. Bootstrap rejects any other
`process.execPath`, symlink, non-regular or multiply linked file, foreign owner,
or group/world-writable mode before repository or network work. It reads the
Node binary across a stable filesystem identity, records its digest, and binds
the parent's `process.version` in the same tool evidence as the other trusted
executables. Bun is not an accepted release-phase runtime. Inside the Core
release program it is an absolute validated child executable only for
`bun install --frozen-lockfile` and `bun run check` during credentialless
`prepare`; no other phase starts Bun.

Before any Git child exists in `audit`, `sign-tag`, `publish`, or
`record-push`, Node/runtime filesystem APIs close the broker-sealed detached
checkout without consulting Git: the root and standalone real `.git` directory,
detached `HEAD == S`, fixed local-config allowlist, absence of worktree/common-dir and
info-attributes extensions, object-store accelerators, and source-S tracked
`.gitattributes` bytes are checked directly. Tracked attributes containing
`filter`, `diff`, `working-tree-encoding`, or `process` semantics fail closed,
as do untracked attribute files. Privileged Git always disables fsmonitor,
system attributes, replacement objects, optional index locks, external diff,
hooks, credential helpers, and the `ext` protocol. The closure is re-read
before every later Git child. Publication Git object and network work uses a
new private bare repository; it never gives the invoking worktree's mutable
tag ref or Git configuration custody of the token.

Every qualification, ruleset-audit, review, tag-bundle, and record artifact
has root/current-UID custody, one-link regular files, a non-symlink private
0700-class task parent, and no group/world-writable file. Reads bind device,
inode, size, modification time, and digest across the read. Inputs are
re-read against those identities immediately before signing, tag push,
Release POST, or main CAS. The record artifact v3 manifest additionally binds
the artifact-root owner and mode; rename replacement and shared-writable
custody fail closed.

This is not a claim that the full transitive closure of Git, Go, Bun, TLS,
kernel, or dynamic libraries was measured. Those dependencies remain inside
the declared trusted-system boundary.

## 1. Prepare

`prepare` starts from clean, attached canonical `main` at exact `S`; public
canonical `main` must also equal `S`. It requires a non-shallow source without
replacement refs, alternates, Go workspace mode, or module replacements. It
clones `S` twice, detaches each clone, removes its remote, and fences exact
`HEAD`, source tree, and clean status before and after every lifecycle, build,
inspection, and binary command.

The clean fence is not Git-status-only. A raw, rehashed source-S tree is
compared to the filesystem, so ignored and untracked content such as `dist`,
`.release-tmp`, `.claude`, and Terraform state is rejected in both the
invoking checkout and isolated clones. After the frozen install, the sole
exception is the exact measured `node_modules` closure. Its paths, types,
ownership, links, modes, sizes, times, and content digests are sealed before
the owner gate and must remain identical through all later builds and binary
execution; a dependency symlink may not escape that measured closure. The
isolated clone's complete Git-metadata file closure is also
sealed; additions, removals, or file drift fail.

Only this phase runs source-controlled commands or built binaries. Each clone
runs `bun install --frozen-lockfile`, then `bun run check`, then builds all
three commands with `CGO_ENABLED=0`, `-trimpath`, and `-buildvcs=false` for
Darwin, Linux, and Windows on amd64 and arm64. The host builds execute
`version`. Both runs must produce identical binary and Go-metadata digests and
exact version output bound to `v0.1.0` and `S`.

The only output is one canonical, closed, operator-private qualification JSON
file. There are no archives, SBOM, provenance document, checksum signature,
private asset directory, or GitHub Release asset.

## 2. Audit

`audit` runs from a clean detached checkout of `S`. It sends one authenticated
`GET /repos/tako0614/takoform/rulesets/ID` with the pinned GitHub API version.
The response must contain `bypass_actors`; omission fails closed. It normalizes
one exact canonical artifact `A` containing repository, tag, ruleset id,
target, active enforcement, `bypassActors: []`, exact include/exclude
conditions, exact deletion/update rules, and API version. Extra, creation,
signature, merge-permitting, excluded-ref, inactive, or bypass state fails.

## 3. Sign tag

`sign-tag` runs from clean detached `S`, performs no network request, source
lifecycle, build, or product-binary execution, and accepts only the pinned SSH
private-key path. It verifies the qualification file, canonical `A`, and one
exact independent-review v2 record. The review binds `S`, the qualification
digest, the audit digest, and the fixed review checklist.

The exact annotated tag message contains full canonical `A` plus the
qualification, review, and audit digests. Git uses explicit SSH signing and an
absolute validated `ssh-keygen`; the resulting raw tag object is verified
against the repository allowed-signers file. The closed private tag bundle
contains the raw object bytes, exact object id, digest, annotation, and tool
evidence. Publication never reads a mutable `refs/tags/v0.1.0` as its source.

## 4. Publish and recover

`publish` runs clean detached S-pinned logic. Canonical main may equal `S` or
be a first-parent descendant. It accepts only `GH_TOKEN`, revalidates all four
private artifacts and the tag signature, and performs no install, gate, build,
product-binary, checksum, asset, or Go-proxy work.

`--mode forward` requires initially absent tag and Release. `--mode recover`
uses the same forward-only state machine and adopts exact existing state. It
creates only a missing exact tag or Release; it never patches, deletes,
re-signs, retags, uploads, recreates, or replaces anything. Conflicting,
draft, mutable, prerelease, nonempty, or ambiguous state fails closed.

Immediately before a missing tag is pushed, a fresh authenticated ruleset GET
must normalize byte-for-byte to signed `A`. The create-only push uses the exact
verified tag object id as its source and a width-correct zero-object lease;
there is no mutable local tag ref. Both the installed object and privileged Git
network operations live in a fresh private bare repository with system/global
configuration disabled, so mutable source-checkout Git configuration cannot
redirect the token. A fresh repository then fetches and verifies the remote raw
object, peel to `S`, exact annotation, principal, fingerprint, and signature.

Immediately before the sole possible Release POST, the state machine freshly
verifies the signed remote tag, authenticated Release absence, and another
byte-equal authenticated `A`. The POST is non-draft, non-prerelease, and
asset-free. Its exact response and credentialless public readback must report
`immutable: true` and `assets: []`. An indeterminate mutation is adopted only
when readback finds the exact identity; otherwise recovery is a later explicit
invocation.

The public statement is narrowly historical: publication-time `A` is attested
by the pinned tag signer. Neither the Release nor later verification claims
that GitHub's hidden current bypass state is still empty.

## 5. Record prepare

`record-prepare` runs clean detached S-pinned logic without a token. It freshly
fetches and verifies the signed tag and its full embedded `A`, then verifies
the exact immutable empty Release. It compares `Sum` and `GoModSum` from
`GOPROXY=https://proxy.golang.org` with a separate `GOPROXY=direct` download;
direct `Origin` must say Git, the exact repository, `Hash: S`, and
`Ref: refs/tags/v0.1.0`. `GOSUMDB=sum.golang.org` is set while every private,
no-proxy, no-sum, and insecure bypass is cleared.

It performs all three exact versioned installs and executes each installed
binary's `version` command. Every output must bind command, module, version,
and module sum. The receipt records these outputs rather than claiming a
source revision that vanilla module build information does not expose.

Canonical main is fetched as `P`. `S` must be on `P`'s first-parent history,
and the ledger blob at `P` must be object-identical to its blob at `S`.
Credentialless Git plumbing constructs one-parent commit `R` changing only
`release/core-releases.json` from the exact candidate to one v2 receipt. The
receipt omits `R`, avoiding circular identity. The phase emits one closed
operator-private directory containing a canonical manifest and private bare
repository, including a complete file inventory and the private root's owner
and mode. It has no ref credential.

## 6. Record push

`record-push` accepts only `TAKOFORM_CORE_REF_WRITE_TOKEN` and requires the
invoking checkout to be clean, detached, and exactly the artifact's reviewed
`S`. Before exposing the token to a child, it verifies the artifact inventory
twice across the private copy, requires one fixed non-extensible bare-repository
Git config, and rejects hooks, alternates, grafts, shallow/promisor state,
loose or packed replace refs, monolithic or split commit graphs, multi-pack
indexes, reverse indexes, and bitmap accelerators. An
accelerator-independent raw Git object reader validates loose objects and
pack-index/pack checksums, resolves and applies OFS/REF deltas, rehashes every
commit/tree/blob it trusts, parses raw `R` to require the exact sole
`parent P` header, walks and rehashes the raw first-parent `P -> S` lineage,
and proves the raw one-ledger-path tree transition. Strict full `git fsck` is a
redundant integrity gate, not the parent-authority source. These checks
establish that `R` is a fast-forward of the exact `P` lease before the fixed
origin/ref CAS.

This phase invokes only the validated absolute Git executable. It does not run
Go, Bun, package tools, source gates, builds, product binaries, `curl`, `gh`,
or an arbitrary `PATH` command. The token is supplied only to exact Git remote
readback, `P -> R` compare-and-swap, and authoritative readback. A stale `P`
with an unchanged ledger is a classified CAS loss; the operator reruns
`record-prepare`. Non-descendant, rewritten-ledger, competing-receipt, missing
`R`, or indeterminate readback state fails closed.

## 7. Verify

`verify` runs clean detached S-pinned logic without credentials. It requires
`R` on current main's first-parent history, sole parent `P`, `S` on `P`'s
first-parent history, source/P ledger identity, an exact one-ledger-path
`P -> R` transition, and the current ledger blob still equal to `R`.

It then repeats fresh signed-tag, immutable Release, proxy/direct/sumdb, three
install, and installed-version-output checks and compares the reconstructed
v2 receipt byte-for-byte with `R`. It reads publication-time `A` from the
signed tag. It deliberately performs no public ruleset GET and makes no claim
about current hidden bypass actors.
