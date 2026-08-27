# Project and Form lifecycle

Takoform is a portable desired-state specification and tooling project. Core
defines data formats, exact identities, deterministic compilation, and the
protocol documents; it is not a standards body, certification authority,
universal cloud API, catalog, or promise that a resource can move between
backends without migration.

This document defines the lifecycle vocabulary for a Form. Exact compatibility
rules are in [`versioning.md`](versioning.md), package and artifact checks are
in [`conformance.md`](conformance.md), and the portable field boundary is in
[`portability-boundary.md`](portability-boundary.md).

Core has no built-in Form roster or preferred family. A publisher supplies a
package and its exact contracts; an operator decides which publisher policy to
trust; a Host independently decides which exact identities it can implement.
The same mechanism applies to project-maintained and third-party publishers.

## Independent facts

These facts MUST remain separate:

| Fact | Owning authority | Meaning |
| --- | --- | --- |
| Historical Specification receipt | Immutable W09 ledger and signed record head | The sealed 1.1 source snapshot; there is no current numbered writer |
| Form maturity | A scoped lifecycle record | Confidence in one portable contract |
| Package publication | The publisher's release evidence | Exact bytes can be retrieved and authenticated |
| Publisher trust | Operator-selected policy | Which provenance and signatures are accepted |
| Host Support | A named Host | That Host implements one exact identity |
| Form Activation | Host or operator policy | A supported identity is usable in one scope |
| Service Offering | A commercial platform | Capacity, price, availability, and support |
| Client projection | The client that provides it | Local schema, state, and migration behavior |

No historical receipt, package, trust policy, generated index, Host report,
activation, or Service Offering MAY by itself promote Form maturity. A Host
MUST NOT describe its support decision as Takoform approval or certification.

Specification 1.1 is recorded in the append-only
[`release/specification-releases.json`](../release/specification-releases.json)
ledger. Its release is independent of Form, package, client, and Host
adoption. The current Core tree may contain a later draft; changing that draft
does not rewrite the immutable predecessor receipt.

## Form families

Forms use publisher-controlled, versionless reverse-DNS groups. The group is
part of the exact FormRef but does not confer maturity or support. See
[`form-families.md`](form-families.md) for the namespace and role rules. A
family may contain any subset of a publisher's Forms; Core does not maintain a
central list.

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
replacement/import/delete/recovery analysis, and known limitations. Independent
Hosts and production consumers MAY strengthen the adoption record, but their
existence does not grant normative authority over Core or another publisher's
Form.

Stable does not guarantee that every Host supports the Form or that any
commercial platform offers it. A historical Specification receipt or Host
protocol release does not trigger a Form transition.

### Legacy

A Legacy Form is an immutable published identity retained for compatibility,
recovery, and explicit migration but no longer recommended for new work. The
record MUST identify the reason, exact affected FormRefs, successor or
alternative when one exists, new-create policy, and retained read/observe,
delete, and recovery behavior.

Moving a Form to Legacy MUST NOT delete or overwrite its Definition, package,
tag, signature, revocation evidence, or migration material.

## Retained predecessor line

Forms and admission documents published by the predecessor repository remain
immutable history. Their historical status fields and lane names describe the
documents at that time; they do not define a current official subset or Core
catalog. The byte-exact predecessor source is available at the
[W09 commit](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36/spec).

The extracted W09 records under
[`docs/extraction/history/`](../docs/extraction/history/README.md) explain that
lineage and are not current lifecycle inputs. New lifecycle data MUST NOT
rewrite those retained bytes merely to change their historical labels.

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
package. Project-maintained and independent publishers use the same authoring,
verification, and admission path; provenance and operator trust are the only
distinction.

## Deprecation and security revocation

Deprecation is a consumer migration contract. It identifies the reason,
successor, timing for rejecting new create/apply, retained lifecycle behavior,
and migration instructions.

Security revocation is separate and append-only as defined by
[`trust/`](../trust/). It may block new creation, update, or activation while
the referenced bytes remain available for observation, deletion, recovery, or
an explicit operator evacuation path.
