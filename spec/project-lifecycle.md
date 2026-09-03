# Project and Form lifecycle

Takoform defines a portable desired-state model and Host API. Its contracts
define data formats, exact identities, deterministic compilation, and protocol
documents. This document defines the lifecycle vocabulary for Forms published
under those contracts.

Exact compatibility rules are in [`versioning.md`](versioning.md), package and
artifact checks are in [`conformance.md`](conformance.md), and portable field
selection is in [`portability-boundary.md`](portability-boundary.md).

Takoform has no built-in Form roster or preferred family. A publisher supplies a
package and its exact contracts; an operator decides which publisher policy to
trust; a Host independently decides which exact identities it can implement.
The same mechanism applies to every publisher.

## Independent facts

These facts MUST remain separate:

| Fact | Owning authority | Meaning |
| --- | --- | --- |
| Form maturity | A scoped lifecycle record | Confidence in one portable contract |
| Package publication | The publisher's release evidence | Exact bytes can be retrieved and authenticated |
| Publisher trust | Operator-selected policy | Which provenance and signatures are accepted |
| Host Support | A named Host | That Host implements one exact identity |
| Form Activation | Host or operator policy | A supported identity is usable in one scope |
| Service Offering | A commercial platform | Capacity, price, availability, and support |
| Client projection | The client that provides it | Local schema, state, and migration behavior |

No API publication, package, trust policy, generated index, Host report,
activation, or Service Offering MAY by itself promote Form maturity. A Host
MUST NOT describe its support decision as Takoform approval or certification.

A software/library release is separate from the Host API lane and from Form,
package, client, and Host adoption. Changing one does not change the others.

## Form families

Forms use publisher-controlled, versionless reverse-DNS groups. The group is
part of the exact FormRef but does not confer maturity or support. See
[`form-families.md`](form-families.md) for the namespace and role rules. A
family may contain any subset of a publisher's Forms; Takoform does not
maintain a central list.

## Form lifecycle

### Proposal

A Form Proposal is mutable, unversioned design material. It has no public
FormRef, package release, compatibility promise, or maturity claim and MAY be
removed or changed incompatibly.

A Proposal MUST name:

- the workload and consumer that need the Form;
- the maintainer responsible for its portable semantics;
- an intended Host or other implementation context;
- the desired-state boundary and decisions left to a Host;
- replacement, import, delete, recovery, and data-loss risks;
- credential, network, artifact, and secret boundaries; and
- relevant prior art and why an existing abstraction is insufficient.

Every desired field MUST be classified using
[`portability-boundary.md`](portability-boundary.md). A first implementation or
commercial offering is workload evidence, not permission to copy a product
model into a Form. Prior-art review is a design obligation, not a compliance
claim.

Creating or revising a Proposal does not require publication authority.

### Experimental

An Experimental Form is a reproducible public contract on a `0.x` line. Its
released bytes are immutable, while its semantics may change only by the
`0.x` rules in [`versioning.md`](versioning.md).

A Proposal MAY become Experimental only when the reviewed record contains:

- one canonical Form Definition and exact FormRef;
- positive and negative data fixtures for the portable semantics;
- known limitations and unresolved portability questions;
- compatibility and migration or rollback analysis;
- security-boundary review;
- documentation that agrees with the Definition; and
- package provenance and an explicit publication plan, when publication is
  requested.

These checks prepare a release; they do not publish it or claim Host Support.
The immutable Definition contains no maturity field. Maturity is recorded by
one lifecycle authority outside Definition bytes.

### Stable

A Stable Form is an evidence-earned portable contract, not a central approval
applied to a preferred subset. An Experimental Form becomes Stable only by an
explicit per-Form decision that mints its own `1.0.0` identity.

That decision MUST bind the exact predecessor FormRef, compatibility analysis,
portable positive and negative evidence, migration or no-migration guidance,
replacement/import/delete/recovery analysis, and known limitations. Host or
consumer adoption is optional supporting evidence, never a Form transition or
Host API lane change prerequisite, and grants no normative authority over
another publisher's Form.

Stable does not guarantee that every Host supports the Form or that any
commercial platform offers it. An API or software release does not trigger a
Form transition.

### Legacy

A Legacy Form is an immutable published identity retained for compatibility,
recovery, and explicit migration but no longer recommended for new work. The
record MUST identify the reason, exact affected FormRefs, successor or
alternative when one exists, new-create policy, and retained read/observe,
delete, and recovery behavior.

Moving a Form to Legacy MUST NOT delete or overwrite its Definition, package,
tag, signature, revocation evidence, or migration material.

## Compatibility history

Historical lifecycle records describe their exact occupied identities and are
not current maturity evidence. They remain immutable and MUST NOT be rewritten
or relabelled; [`versioning.md`](versioning.md) defines how retained identities
are read and deprecated.

## Change authority

A public Form change MUST update the canonical Definition, fixtures,
compatibility and migration analysis, lifecycle and security risks, and the
scoped maturity record in one reviewed change. A package digest, Host report,
client projection, or Service Offering is updated only by its owner when that
fact changes.

Checks MUST fail closed on an unknown lifecycle state, missing maintainer,
changed published bytes, or a maturity claim inferred from Host, client, Cloud,
or commercial data.

One closed data-only Form Package contains one Definition and one exact FormRef.
A catalog or compatibility set is an external mapping, never a multi-Form
package. All publishers use the same authoring, verification, and admission
path; provenance and operator trust are the only distinction. Each publisher
deploys its own Form pages and package publication surface; Takoform does not
maintain a central Form site or catalog.

## Deprecation and security revocation

Deprecation is a consumer migration contract. It identifies the reason,
successor, timing for rejecting new create/apply, retained lifecycle behavior,
and migration instructions.

Security revocation is separate and append-only as defined by
[`trust/`](../trust/). It may block new creation, update, or activation while
the referenced bytes remain available for observation, deletion, recovery, or
an explicit operator evacuation path.

A publisher's verified, signed sequence-zero revocation genesis proves only
that its authenticated current revocation set is empty at that checkpoint. It
does not publish a package, establish publisher trust, promote Form maturity,
assert Host Support, activate a Form, provision a Resource, or create a Service
Offering. An absent, unsigned, or merely schema-valid genesis proves none of
those facts and cannot authorize `CheckNotRevoked`.

Retained release identities and their exact source records are documented in
[`versioning.md`](versioning.md); this lifecycle record does not reinterpret
those bytes as current maturity evidence.
