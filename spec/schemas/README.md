# Public schema identity index

This non-normative index is derived from the append-only
[`release/public-schema-identities.json`](../../release/public-schema-identities.json)
ledger. It may track future identities without changing the frozen Host API v1
closure, and it does not assign authority or reinterpret any schema. The exact
v1 schema subset is named by
[`../host-api/v1.freeze.json`](../host-api/v1.freeze.json); each schema's owning
contract defines whether and how its structural minimum is normative.

## Non-retired schema identities

These files are in the append-only ledger's non-retired identity list. That
list contains both current authoring profiles and retained readable profiles;
non-retired does not by itself mean preferred for new documents. The contract
column states the role of each identity.

| Schema | Contract |
| --- | --- |
| [`form-ref-v1beta1.schema.json`](form-ref-v1beta1.schema.json) | the Beta namespaced-group four-field immutable Form reference |
| [`form-definition-v1beta1.schema.json`](form-definition-v1beta1.schema.json) | the Beta data-only Form Definition with roles, exact Interfaces, and typed Bindings |
| [`form-ref-v1beta2.schema.json`](form-ref-v1beta2.schema.json) | the retained transition reference that first admitted versionless groups alongside versioned groups; current Form Definitions use `form-ref-v1` |
| [`form-definition-v1beta2.schema.json`](form-definition-v1beta2.schema.json) | the retained transition Form Definition for versionless groups and typed desired-state contracts |
| [`form-definition-v1.schema.json`](form-definition-v1.schema.json) | the current versionless-group Form Definition profile with closed structural and resolved-UID constraints |
| [`form-ref-v1.schema.json`](form-ref-v1.schema.json) | the current exact four-field Form reference for one versionless Form Family group; the referenced Form's own `definitionVersion` remains independent |
| [`package-index-v1alpha4.schema.json`](package-index-v1alpha4.schema.json) | the retained Provider 2.1.1 content-addressed package profile for versioned family FormRefs |
| [`package-index-v1alpha5.schema.json`](package-index-v1alpha5.schema.json) | the current content-addressed package profile for versionless-group FormRefs |
| [`form-package-revocation-v1.schema.json`](form-package-revocation-v1.schema.json) | the current append-only revocation statement for an exact package and versionless FormRef |
| [`form-package-revocation-checkpoint-v1.schema.json`](form-package-revocation-checkpoint-v1.schema.json) | the current cumulative checkpoint profile, rooted in its one signed empty sequence-zero genesis |
| [`form-package-revocation.schema.json`](form-package-revocation.schema.json) | the retained v1alpha1 revocation statement for a retained FormRef |
| [`form-package-revocation-checkpoint.schema.json`](form-package-revocation-checkpoint.schema.json) | the retained v1alpha1 cumulative checkpoint profile whose historical chains begin at sequence one |
| [`host-discovery-v1beta1.schema.json`](host-discovery-v1beta1.schema.json) | the Beta host discovery document |
| [`host-api-wire-v1beta1.schema.json`](host-api-wire-v1beta1.schema.json) | the Beta UID/generation/revision Resource, condition, operation, artifact, and error envelopes |
| [`host-discovery-v1beta4.schema.json`](host-discovery-v1beta4.schema.json) | the retained Beta 4 Host discovery document |
| [`host-api-wire-v1beta4.schema.json`](host-api-wire-v1beta4.schema.json) | the retained Beta 4 Resource, condition, operation, artifact, and error envelopes |
| [`host-discovery-v1.schema.json`](host-discovery-v1.schema.json) | the current `forms.takoform.com/v1` Host discovery document |
| [`host-api-wire-v1.schema.json`](host-api-wire-v1.schema.json) | the current UID/generation/revision Resource, condition, operation, artifact, and error envelopes |
| [`interface-ref-v1alpha1.schema.json`](interface-ref-v1alpha1.schema.json) | the exact digest-bound Interface reference |
| [`interface-definition-v1alpha1.schema.json`](interface-definition-v1alpha1.schema.json) | the exact data-only Interface Definition with operations, semantics, and behavior fixtures |
| [`binding-ref-v1alpha1.schema.json`](binding-ref-v1alpha1.schema.json) | the exact digest-bound Binding reference |
| [`binding-definition-v1alpha1.schema.json`](binding-definition-v1alpha1.schema.json) | the retained typed Binding Definition, whose target groups all carry a version |
| [`binding-definition-v1alpha2.schema.json`](binding-definition-v1alpha2.schema.json) | the current typed Binding Definition: source role, target Interface, runtime projection, and a target group that may carry no version |
| [`binding-ref-v1alpha2.schema.json`](binding-ref-v1alpha2.schema.json) | the exact BindingRef into the current Binding envelope |
| [`artifact-manifest-v1alpha1.schema.json`](artifact-manifest-v1alpha1.schema.json) | the content-addressed artifact manifest for uploaded bundles |
| [`operation-v1alpha1.schema.json`](operation-v1alpha1.schema.json) | the long-running Operation envelope |
| [`operation-v1alpha2.schema.json`](operation-v1alpha2.schema.json) | the retained Beta 4 long-running Operation envelope |
| [`operation-v1.schema.json`](operation-v1.schema.json) | the current long-running Operation envelope |
| [`standard-service-ref-v1alpha1.schema.json`](standard-service-ref-v1alpha1.schema.json) | the retained closed-vocabulary StandardServiceRef identity |
| [`standard-service-ref-v1.schema.json`](standard-service-ref-v1.schema.json) | the current provider-neutral StandardServiceRef with an opaque normalized namespaced protocol identifier |
| [`host-support-profile-v1alpha1.schema.json`](host-support-profile-v1alpha1.schema.json) | the first retained Host Support Profile identity |
| [`host-support-profile-v1alpha2.schema.json`](host-support-profile-v1alpha2.schema.json) | the retained versionless-Form-group Host Support Profile identity |
| [`host-support-profile-v1.schema.json`](host-support-profile-v1.schema.json) | the current Host Support Profile, including exact fail-closed support for opaque standard-service identifiers |

## Verify-only schema identities

These retired entries remain byte-exact inputs for verification. They cannot be
used to publish a new document under an occupied identity. Compatibility
history is centralized in [`versioning.md`](../versioning.md).

| Schema | Contract |
| --- | --- |
| [`host-discovery.schema.json`](host-discovery.schema.json) | the verify-only v1alpha1 Host discovery document |
| [`form-definition.schema.json`](form-definition.schema.json) | the verify-only v1alpha1 Form Definition |
| [`form-ref.schema.json`](form-ref.schema.json) | the verify-only v1alpha1 Form reference |
| [`host-api-wire.schema.json`](host-api-wire.schema.json) | the verify-only v1alpha1 Host wire envelopes |
| [`package-index.schema.json`](package-index.schema.json) | the verify-only v1alpha1 package profile |
| [`form-definition-v1alpha2.schema.json`](form-definition-v1alpha2.schema.json) | the verify-only v1alpha2 Form Definition |
| [`form-ref-v1alpha2.schema.json`](form-ref-v1alpha2.schema.json) | the verify-only v1alpha2 Form reference |
| [`host-api-wire-v1alpha2.schema.json`](host-api-wire-v1alpha2.schema.json) | the verify-only v1alpha2 Host wire envelopes |
| [`host-discovery-v1alpha2.schema.json`](host-discovery-v1alpha2.schema.json) | the verify-only v1alpha2 Host discovery document |
| [`package-index-v1alpha2.schema.json`](package-index-v1alpha2.schema.json) | the verify-only v1alpha2 package profile |
| [`form-definition-v1alpha3.schema.json`](form-definition-v1alpha3.schema.json) | the verify-only v1alpha3 Form Definition |
| [`form-ref-v1alpha3.schema.json`](form-ref-v1alpha3.schema.json) | the verify-only v1alpha3 Form reference |
| [`host-api-wire-v1alpha3.schema.json`](host-api-wire-v1alpha3.schema.json) | the verify-only v1alpha3 Host wire envelopes |
| [`host-discovery-v1alpha3.schema.json`](host-discovery-v1alpha3.schema.json) | the verify-only v1alpha3 Host discovery document |
| [`package-index-v1alpha3.schema.json`](package-index-v1alpha3.schema.json) | the verify-only v1alpha3 package profile |

The Form Package verifier embeds its own copies of the package schemas so it
has no filesystem dependency at runtime. The wire-envelope schema is normative
and is consumed by host/provider conformance rather than embedded in the
data-only package verifier. `go test ./spec` compiles every schema and proves
every implementation copy is byte-identical to its normative source.

Every schema `$id` is a logical URI. The files in this directory are the only
current contract source, and `bun run check:records` requires every non-retired and
verify-only file, `$id`, raw SHA-256 digest, and ledger entry to agree.

This repository also publishes those bytes. The `takoform.com` site it owns
serves each identity at the exact path its `$id` names, and `bun run check:site`
requires every served copy to equal its normative source byte for byte. It
holds no account, zone, credential, or DNS state for those URLs: which
hostnames resolve to that site is the publishing operator's authority, and the
procedure is in [`docs/site.md`](../../docs/site.md).

[`release/public-schema-identities.json`](../../release/public-schema-identities.json)
is the append-only identity ledger: it preserves each exact digest, normative
source, and public path. A withdrawn identity moves to the ledger's `retired`
list with the bytes it had and the reason, and can never be reused for
different bytes. The repository gate requires the complete schema source set to
equal that ledger; realized availability and hosted-byte readback remain
outside it.
