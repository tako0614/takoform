---
# Generated from spec/host-api/v2/forms.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/host-api/v2/forms.md
canonicalUrl: /_source/host-api/v2/forms.md.txt
sourceLanguage: en
releaseState: revision-open
---

<div lang="en" class="specification-source">

# Defining a Form

This specification defines how a Form describes one kind of resource for Takoform Host API v2. A Form author owns the resource-specific contract. A Host implements that contract; a client uses it. The common HTTP requests, Resource envelope, Operation lifecycle, status codes, and retry rules are defined by the [HTTP API](/en/spec/host-api/v2/http), not redefined here.

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe requirements on a Form specification. A Form may use another clear style, but its requirements and choices must be unambiguous.

## 1. A Form is a published contract {#publication}

A Form is a human-readable specification for one resource kind. It defines the resource's purpose, accepted desired input, observable state, output, lifecycle behavior, dependencies, and any runtime interface. It is not executable code and is not an instruction for a Host to fetch or run code from the Form URL.

A Form is identified by its **exact serialized Form URL**. The URL MUST be an ASCII-serialized absolute HTTPS URL with a non-empty host. It MUST NOT contain user information, a query, or a fragment. A path is optional; the origin root can identify a Form contract. Encode non-ASCII characters in the URL as needed. Comparison is exact string comparison: Hosts and clients MUST NOT change case, normalize a path, add a slash, follow a redirect, or substitute an alias to decide that two URLs identify the same Form. See [HTTP API §1](/en/spec/host-api/v2/http#common-format) for the shared URL rules.

The URL MUST continue to identify the same contract. A publisher may use a version-shaped path such as `/forms/Example/1.0.0/`, but Takoform does not infer compatibility from that text or prescribe a Form versioning scheme. A publisher MUST NOT silently change the meaning at an existing URL. A semantic change requires a new exact URL; a change to explanatory material that does not alter the contract does not.

The specification is published for people to read, normally over HTTPS. A URL does not authenticate its publisher, prove provenance, grant trust, or make a Host support the Form. A Host MUST implement a Form explicitly and MUST NOT discover or execute Forms by fetching URLs supplied in API requests. Form publication and Host support are separate facts. The Host's exact-URL support response is defined in [HTTP API §3](/en/spec/host-api/v2/http#support).

Takoform v2 does not require a package, signature, publisher catalog, transparency log, trust registration, or `official` publisher status. A publisher or user may choose additional distribution or provenance practices, but they are not implicit API requirements.

## 2. What a Form specification must define {#what-a-form-specification-must-define}

A Form specification MUST define each of the following areas. If an area does not apply, say so explicitly. Section names and order are up to the author.

1. **Purpose and scope.** State what one Resource represents and what it owns. Distinguish the Host API version from the Form identity. Do not imply that the Resource owns a provider, route, credential, dataset, or runtime that it does not control.
2. **Desired input.** Define the complete `spec` object, including every field's type, meaning, requiredness, omission behavior, default, constraints, and whether it can change after creation. Define limits and units precisely.
3. **Private inputs.** Define any `privateInputs` names, values, requiredness, use, and update or retry behavior. If there are none, say so; the Host API rules still apply.
4. **Observation and output.** Define the complete shape and meaning of `observed` and `output`, when values are known, how stale values are identified, and what `ready` means if the Form has a readiness concept.
5. **Lifecycle.** Define create, read, update, and delete behavior, identify which operations the Form requires, and explain immutable or rejected operations, failures, partial effects, retries, and recovery after an uncertain result.
6. **References and ownership.** Define referenced Resource UIDs, required exact Form URLs, owner/Space constraints, any relationship between target specs, and deletion consequences.
7. **Interfaces and Bindings.** Define any runtime interface the Resource implements and any typed capabilities it consumes. If none apply, say so.
8. **Artifacts and transport.** Define how required code or data is selected, transferred, bounded, verified, retained, and removed. If none apply, say so.
9. **Unknown fields and extensions.** At each object boundary, say whether unknown fields are rejected, ignored, preserved, or handled by a named extension rule. Do not rely on a global default.

The specification MAY include JSON Schema, examples, diagrams, or other machine-readable aids. These are supplemental unless the Form explicitly makes one normative. If a supplemental artifact conflicts with the normative prose, correct the inconsistency; do not leave Hosts to guess which meaning wins.

## 3. Desired state, observation, and output {#state}

The common [Resource](/en/spec/host-api/v2/http#resources) separates user intent from Host observation and returned values:

- **`spec`** is the desired configuration for this exact Resource.
- **`observed`** reports facts the Host has confirmed about the managed resource or its dependencies.
- **`output`** returns values needed to use the resource, such as an assigned address.

A Form MUST define the complete schemas and semantics of its own fields in all three objects. It MUST distinguish an unobserved or unknown value from a confirmed false, absent, or unready value. It MUST NOT present a timeout, unavailable dependency, or failed check as confirmed absence or readiness.

The common Resource fields `generation`, `observedGeneration`, and `observedAt` identify which desired generation was last confirmed and when. A Form MUST NOT treat a newly accepted generation as observed before its requirements are confirmed. A Form-specific timestamp or version may be included in `observed` when one common timestamp is insufficient.

A Form MAY define a readiness concept. It MUST state its exact positive conditions and what a negative or missing value means. `phase: idle` and a successful management Operation are not generic readiness signals. A Form MUST NOT claim application health, external reachability, or business success unless it defines and actually measures that condition.

Output is not a second desired-state channel. Define when output first becomes available, whether it is immutable, how it behaves during pending or failed operations, and whether it survives restart. If an address is allocated at acceptance, the Form and Host must preserve that exact value while the route or target is still converging; retrying a request must not silently allocate a replacement.

Reads return the Resource and the last observation under the common [read rules](/en/spec/host-api/v2/http#read). A Form MAY require or offer an explicit refresh behavior, but MUST define it. A GET MUST NOT be assumed to create, update, delete, or retry the resource. If an external object disappears, the Host still returns the management record while it retains that record; the Form says how the missing object appears in `observed` and how update or delete repairs it.

## 4. Lifecycle and failure behavior {#lifecycle}

The common HTTP API defines create, read, update, and delete. A Form MUST define the resource-specific behavior of each and explicitly identify which operations it requires. It MUST explain any immutable or rejected operation, including when rejection occurs and whether it has effects. The Host implements every operation required by a Form. For a supported Form, the support response MUST list every required operation exactly once, with no duplicates; if any required operation is not implemented, the Host cannot report that Form as supported. The common HTTP API still owns status codes, headers, generations, Operation states, and idempotency. Link each operation to the common [Resource](/en/spec/host-api/v2/http#resources), [Operation](/en/spec/host-api/v2/http#operations), [retry](/en/spec/host-api/v2/http#retry), and [error](/en/spec/host-api/v2/http#errors) contracts.

### Create

Define what new identity or external state is created, which values are immutable, how uniqueness is scoped, and when success can be reported. Distinguish input validation or a known precondition failure from an accepted Operation that later fails. Define whether success means durable configuration, an allocated resource, a confirmed observation, or some other specific result.

### Read

Define which recorded and observed fields are returned, including before the first observation and after a dependency or external object is missing. State whether reads may refresh observation. Do not require the common API to reveal private state.

### Update

The HTTP request replaces the complete `spec`; it is not a JSON patch. A Form MUST say which fields may change, which are immutable, and what a same-spec update means. If an update is immutable, define the exact equivalence rule and reject a changed desired state before external effects. If a transition changes an external resource, define ordering, rollback or compensation limits, and how partial state remains visible.

An accepted same-spec update is still a new common API Operation and generation. It is not a reason for the Form to suppress reconciliation or silently omit the requested Operation.

### Delete

Define the exact deletion scope. A Form MUST state whether it deletes only its own managed resource, which dependent references block deletion, and what happens to independent data or child resources. Do not imply cascade deletion unless the Form explicitly owns and defines it. If deletion is idempotent with respect to an already-absent external object, state how absence is confirmed.

If deletion requires stopping work or waiting for invocations, leases, consumers, routes, or external cleanup, define the completion condition. An unresolved cleanup is not a successful delete. Failed or uncertain resources must remain identifiable and recoverable through the same UID's update or delete where possible.

### Errors, partial effects, and retry

List stable, payload-free Form error codes and explain the condition behind each one. Form errors may refine the common error or `Operation.error` classification but MUST NOT contradict common HTTP status, effect, or Operation semantics. Never include credentials, private input values, raw provider responses, or another Resource's private data in errors.

For each external effect, state how the Host distinguishes not sent, complete, partial, and unknown. Define how the same Resource and Operation are reconciled after a lost response, process restart, timeout, or duplicate delivery. A timeout alone MUST NOT mean “no effect.” If the outcome is unknown, the Host retains the Operation as unresolved and uses the same external identity for readback or safe retry; it does not create a replacement under a new name. See [Operation recovery](/en/spec/host-api/v2/http#operations) and [retry retention](/en/spec/host-api/v2/http#retry).

## 5. References, Interfaces, Bindings, and artifacts {#connections}

### Resource references

For every reference, specify a Resource UID and the exact required Form URL. A Host checks the reference's existence, owner, Space, authorization, Form identity, and Form-specific constraints before the relevant effect. References MUST NOT be resolved by display name, URL redirect, “latest” alias, or similar-resource search. Re-creating a deleted target produces a different UID and does not retarget old references.

A reference is not an authorization grant. Each operation still requires the Host's own authorization checks for the caller and referenced resource. A Form MUST state whether references are immutable, when they are replaced, and which live or pending references block deletion. For relationships such as “this Version belongs to this Worker,” define the exact target-spec fields and equality rule.

### Interfaces and Bindings

An **Interface** describes behavior a Resource offers to a caller. A **Binding** describes a typed capability a Resource consumes. For each one, define the exact methods, input and result shapes, errors, limits, streaming or transaction behavior, and relevant authority boundaries. Use a stable exact external contract identity when another published contract owns those details.

Do not imply that a UID reference alone grants the caller, Host, or runtime authority. A Binding MUST NOT silently reveal another Resource's credentials or private inputs. A Form MUST identify who owns the target's behavior and data, and whether deletion of the target is blocked while a live Binding exists.

### Artifacts and transport

The common CRUD API does not define a universal file, code, or data upload protocol. If a Form needs artifacts, it defines their exact identity and how the Host obtains or receives them. Define accepted media types, path rules, byte and count limits, digest algorithm and encoding, manifest rules, custody, retention, and cleanup. Verify actual bytes against the declared digest before reporting them as held or usable.

A digest identifies bytes; it does not prove permission to read them, authorize the caller, or authenticate a publisher. A URL is not permission to fetch arbitrary content. An artifact source must be explicitly selected and authorized, and credentials must not be forwarded to an untrusted URL. A Host must not acquire code or data merely because a Form URL or artifact URL appeared in `spec`.

## 6. Private inputs are optional Host capability {#private-inputs}

Private inputs are distinct from public `spec` and from credentials used to authenticate to the Host. The Form names each accepted input and defines whether it is required for a particular valid operation, what it configures, and whether it can ever be changed. Values are strings in the common v2 wire format.

The Host API makes private-input transport an optional capability. A request may include `privateInputs` only when the Host advertises the capability and the exact Form defines private inputs. If the Host reports `capabilities.privateInputs: false`, the client MUST omit the field entirely; even `{}` is not an accepted substitute. When both conditions hold, the Form defines whether omission and an empty object are equivalent and which names and values are required. See [HTTP API §7](/en/spec/host-api/v2/http#private-inputs).

A Host MUST NOT copy private input values into public `spec`, Resource, Operation, `observed`, `output`, previews, ordinary logs, or errors. The Host may keep protected, temporary material needed for asynchronous execution and same-Operation retry under the common API's rules. The Form defines when configured secrets affect the managed resource; the Host defines its temporary protection, expiry, and key management.

Support is declared for an exact Form URL, not for a private profile. A Host may report a Form supported with `privateInputs: false` when the Form has valid secret-free uses that satisfy its required behavior; a request that needs the unavailable optional capability is rejected with `capability_required`. If private input is intrinsic to every conforming instance or required operation, a Host unable to handle it MUST report the Form unsupported. This exception does not permit partial implementation of other Form semantics such as Bindings or runtime behavior.

## 7. Support and portability {#support}

`GET {root}/support?form=...` reports support for the exact URL, its required CRUD operations, and private-input capability. `supported: true` means the Host implements the Form's normative behavior and required operations. It does not promise authorization, capacity, target availability, a successful individual operation, or application readiness. A request may still fail because its input is invalid, a reference is missing or unauthorized, a dependency is unavailable, a limit is reached, or an external operation fails.

Support is not a per-input profile. A Host MUST NOT claim support while knowingly omitting a required operation or replacing defined semantics with a partial implementation. If the Host lacks a Form-defined capability needed for a valid request—not merely a particular resource, authorization, capacity, or transient runtime—it must not disguise that gap as malformed `spec`. Only the private-input capability described above is independently optional in the common support contract. See [Form support](/en/spec/host-api/v2/http#support).

A Form SHOULD describe outcomes independent of implementation language, database, cloud provider, or SDK. It may define environment constraints or rely on an external Interface/Binding, but MUST name those constraints and avoid implying broader portability than it provides. Host-specific details belong in Host documentation unless the Form intentionally makes them part of its own contract.

## 8. Complete example: KeyValueEntry 1.0.0 {#key-value-entry}

The following fictional Form describes a Host-managed string entry. It is a complete illustrative contract, not a claim that the URL is published or supported by any Host.

| Property | Definition |
| --- | --- |
| Form URL | `https://forms.publisher.example/key-value-entry/1.0.0` |
| Host API | Takoform Host API v2 |
| Purpose | One named string entry in a Host-managed collection. |
| Required operations | `create`, `read`, `update`, and `delete`. |
| Private inputs | None. Omit `privateInputs` on every operation; this Form defines no private-input names. |
| References, Interfaces, Bindings | None. |
| Artifacts | None. |

### Desired input

`spec` MUST be an object with exactly these two fields. Unknown fields and `null` values are rejected.

| Field | Required value | Create/update behavior |
| --- | --- | --- |
| `key` | Unicode scalar string of 1–128 characters. Case-sensitive. | Required on create and immutable for the Resource's lifetime. |
| `value` | Unicode scalar string of 0–4096 characters. The empty string is valid. | Required on create; replaceable by update. |

Lengths count Unicode scalar values, not UTF-8 bytes. There are no implicit defaults. Updating `key` is invalid and rejected as `invalid_spec` before external effects; create a new Resource to use a different key.

```json
{
  "key": "welcome",
  "value": "Hello, Ada!"
}
```

### Observation and output

Before the Host has completed its first observation, `observed` is `{}`. A confirmed observation has this shape:

```json
{ "entryExists": true, "key": "welcome", "value": "Hello, Ada!" }
```

If an observation confirms that the backing entry is absent, it is `{ "entryExists": false }`; `key` and `value` are omitted. An inability to check is not `entryExists: false`. The values are the last confirmed state at the Resource's `observedAt` and `observedGeneration`. A GET returns the recorded observation and is not required to contact the backing store.

`output` is always `{}`. This Form defines no readiness field: an idle Resource or successful Operation does not claim that an application or external client can use the collection.

### Lifecycle and recovery

- **Create:** Create one entry in the collection scoped by `(Host, Space, Form URL, key)`. If another Resource already owns that key, fail its Operation with `key_conflict` and `effect: none`; do not overwrite the existing entry. Report success only after the requested value is durably stored and confirmed.
- **Read:** Return the Resource and its last recorded observation. If the backing entry has disappeared, retain the Resource and report confirmed absence only after checking it.
- **Update:** Replace `value` only. A changed `key` is rejected before any external effect. If the entry is confirmed missing, fail with `entry_not_found` and `effect: none`; update does not recreate it. Report success only after the replacement is durably stored and confirmed.
- **Delete:** Remove this entry only. If it is confirmed absent, deletion is complete. Do not delete the collection or any other entry.
- **Unknown result:** If the Host loses the response after an external write may have occurred, keep the Operation reconciling. Read the exact `(Host, Space, Form URL, key)` and compare the stored value. A matching value can confirm success only when the backend identity is safe for that exact Operation. Absence alone does not prove that a delayed write cannot still occur. Retry or fail only after an idempotency or fencing mechanism makes the same-identity action safe, or after proving the write was never dispatched and cannot later act. Otherwise keep the Operation reconciling. Do not repeat create under another key or silently overwrite a different entry.
- **References:** None; no dependency blocks deletion.

`key_conflict` and `entry_not_found` are stable, payload-free Form error codes. A changed immutable `key` is rejected as `invalid_spec` before effects. The common API still owns HTTP status, Operation retention, `Idempotency-Key`, `Takoform-Expected-Generation`, and retry behavior; see [create](/en/spec/host-api/v2/http#create), [read](/en/spec/host-api/v2/http#read), [update](/en/spec/host-api/v2/http#update), [delete](/en/spec/host-api/v2/http#delete), and [retry](/en/spec/host-api/v2/http#retry).

## 9. Complete cross-resource example: RenderedGreeting 1.0.0 {#rendered-greeting}

This fictional Form creates a durable rendered snapshot from a `KeyValueEntry`. It demonstrates an exact UID reference, independently owned state, an optional secret-dependent mode, observation freshness, and recovery of an uncertain write. It is illustrative, not a public implementation claim.

| Property | Definition |
| --- | --- |
| Form URL | `https://forms.publisher.example/rendered-greeting/1.0.0` |
| Host API | Takoform Host API v2 |
| Purpose | Render and retain one immutable snapshot per successful generation of this Resource UID. |
| Required operations | `create`, `read`, `update`, and `delete`. |
| Reference | `source.resourceUid` MUST identify a Resource with exact Form URL `https://forms.publisher.example/key-value-entry/1.0.0`, owned by the same principal in the same Space. |
| Private input | `signingKey` is required only when `signed` is `true`. |
| Output | The latest confirmed snapshot text and, in signed mode, its signature. |
| Deletion ownership | Delete this Resource's snapshot and secret; never delete or mutate its KeyValueEntry. The live reference blocks deletion of the source entry until this Resource is deleted. |

### Desired input and private input

`spec` is a closed object with exactly these fields:

| Field | Requirement | Mutability |
| --- | --- | --- |
| `source` | Required object with exactly one field, `resourceUid`, naming the KeyValueEntry. | Immutable. |
| `prefix` | Optional string of 0–128 Unicode scalar values; default `""`. | Mutable. |
| `signed` | Optional boolean; default `false`. | Immutable. |

Unknown fields, `null`, malformed references, and values outside the stated bounds are rejected. `prefix` is not secret. The complete desired input for an unsigned snapshot is:

```json
{
  "source": { "resourceUid": "r_1" },
  "prefix": "Welcome: ",
  "signed": false
}
```

When `signed` is false, omit `privateInputs`; this mode defines no private-input capability. When `signed` is true, create requires exactly one non-empty string input named `signingKey`. The Host encodes the string as UTF-8 and uses those bytes as the HMAC-SHA-256 key over the exact UTF-8 snapshot bytes. The signature output is canonical unpadded base64url. The Host MUST NOT put the key in `spec`, Resource, Operation, `observed`, `output`, or ordinary logs. Omitting `privateInputs` on an update retains the configured key. Supplying it again requires the exact original value under common v2 replay and replenishment rules; key rotation requires a new Resource UID. The key is removed when this Resource is deleted.

An unsigned instance is a valid, complete use of this Form. A Host that fully implements the unsigned behavior but does not support private inputs may report this exact Form supported with `privateInputs: false`; signed creates are then rejected with `capability_required`. A Host that reports this Form's private-input capability as available must implement the signed behavior; it cannot claim support while implementing only the unsigned mode. If a Form instead required a secret for every valid instance, a Host unable to accept private inputs would report the Form unsupported.

### Observation, output, and behavior

Before the first completed operation, `observed` is `{}` and `output` is `{}`. Before any target snapshot effect, the Host MUST read the referenced Resource and require a confirmed KeyValueEntry observation with `entryExists: true` and a string `value`. An unobserved source (`observed: {}`), a confirmed absent source, or an unavailable observation fails the accepted Operation with `source_unavailable` and `effect: none`; it MUST NOT invent snapshot content or modify the target. The source value is taken from that observation, and `sourceGeneration` below MUST equal the source Resource's `observedGeneration`, not a possibly newer desired `generation`.

After a successful snapshot, `observed` has this shape:

```json
{
  "ready": true,
  "sourceGeneration": 2,
  "snapshotGeneration": 1,
  "snapshotSha256": "<64 lowercase hexadecimal characters>"
}
```

`sourceGeneration` is the KeyValueEntry's `observedGeneration` whose confirmed value was used. It may be older than the source's desired `generation`; this is a point-in-time copy, not a promise that the source is current. `snapshotGeneration` is this Resource's desired generation when that snapshot was confirmed. `ready: true` applies only to that `snapshotGeneration`; clients compare the Resource's `generation` with `observedGeneration` to determine whether its current desired generation is confirmed. It means the snapshot bytes were durably stored, their digest was confirmed, and the signature was verified if `signed` is true. `observedAt` is when this confirmation completed. If an operation fails, the Host retains the last confirmed observation and does not advance `observedGeneration` to the failed generation.

The output is `{ "text": "<prefix followed by the source value>" }` when unsigned. When signed, it is `{ "text": "...", "signature": "<base64url HMAC-SHA-256>" }`. The signature is computed over the exact UTF-8 bytes of `text`. Output contains no signing key. While an update is pending or fails, keep the previous confirmed output; do not present a partial replacement as current.

### References and lifecycle

Before creating or refreshing a snapshot, the Host verifies that `source.resourceUid` resolves to the exact KeyValueEntry Form in the same Host and Space and that the caller is allowed to use it. The reference is by UID only; the Host does not search by key or name. The reference grants no general permission to read other Resources.

- **Create:** Read the referenced entry's last confirmed value, construct the snapshot, write it under an identity derived from this Resource UID and generation, read it back, and verify its digest (and signature when enabled). Report success only after exact readback.
- **Read:** Return the management Resource and its last confirmed observation/output. A read does not regenerate the snapshot. `sourceGeneration` and `observedAt` tell the client which source state the snapshot used; a later source update does not mutate an existing snapshot.
- **Update:** `source` and `signed` MUST remain unchanged; a changed value is rejected as `invalid_spec` before effects. `prefix` may change and creates a new snapshot for the accepted generation using the source's latest confirmed observation. Before reporting a later update successful, the Host removes and verifies absence of any known partial snapshots left by a terminal failed Operation. This is a full-spec replacement, not a patch.
- **Delete:** Fence all earlier writers for this Resource UID, remove only snapshots owned by this UID and its configured signing material, and verify cleanup before succeeding. Do not delete or modify the KeyValueEntry. The Host releases the reference after the dependent Resource is no longer live. A delete is not complete while any prior dispatch could still recreate or modify an owned snapshot.
- **Uncertain snapshot write:** Use the same Resource UID and generation-derived snapshot identity for reconciliation. Read it back and compare exact bytes and digest. A matching object confirms the write only if the backend guarantees that a stale dispatch for this operation cannot later change that identity. Absence alone does not prove that a delayed write cannot still occur. Retry or fail only after an idempotency or fencing mechanism makes the same-identity action safe, or after proving the write was never dispatched and cannot later act; otherwise remain reconciling. Do not create a second snapshot identity and hide the first. A later update or delete of the same UID must be able to repair or clean up known partial state.
- **Confirmed partial snapshot:** If exact readback proves that a generation-scoped snapshot contains bytes other than the expected complete output, the Host may fail the Operation with `snapshot_incomplete` and `effect: partial` only after fencing that exact operation so no stale writer can later modify the object. Otherwise the Operation remains `reconciling` with `effect: unknown`. On terminal partial failure, the Resource retains its last confirmed observation and output and does not advance `observedGeneration`; the incomplete snapshot remains owned and tracked under the same UID and generation. A subsequent update or delete on that same UID MUST repair or remove it. Delete removes all snapshot generations owned by this Resource, including partial snapshots, before releasing the reference; it never deletes the source Resource.

`source_unavailable` and `snapshot_incomplete` are stable, payload-free Form error codes. For example, suppose `r_1` has `observedGeneration: 2` and confirmed observation `{ "entryExists": true, "key": "greeting", "value": "welcome" }`. Create `rg_1` with `prefix: "Hello "` succeeds at generation 1 with `sourceGeneration: 2`, `snapshotGeneration: 1`, digest `41ae0a89ea376f692a9a2525c4be6b4d10ea296fc165fdc8e1cc1f33bff7e50d`, and output `{ "text": "Hello welcome" }`. An update to `prefix: "Hi "` is accepted at generation 2. If its exact snapshot identity is proven to contain incomplete bytes such as `Hi wel`, and the writer is fenced, its Operation fails with `effect: partial` and `error.code: "snapshot_incomplete"`; the Resource remains at `observedGeneration: 1` with the prior confirmed observation and output. A subsequent delete of `rg_1` at generation 3 removes both its confirmed generation-1 snapshot and partial generation-2 snapshot, then releases its reference. `r_1` remains unchanged. If the old writer cannot be fenced, the generation-2 Operation remains reconciling and the delete cannot be treated as complete until that uncertainty is resolved.

This Form defines no runtime Interface or Binding. Its source reference is a dependency, not a capability token. The KeyValueEntry remains independently owned and usable after this RenderedGreeting is deleted.

## 10. Author checklist {#author-checklist}

Before publishing a new Form URL, verify that a reader can answer all of these questions from its specification:

- What exact Resource does one UID represent, and what does the Form URL identify?
- What is the full `spec` shape? For every field, are requiredness, defaults, limits, unknown fields, and mutability explicit?
- What does the Host return before observation, after a confirmed negative observation, and when the result is unknown?
- What exactly makes an Operation successful? What can fail before acceptance, after acceptance, partially, or with an unknown effect?
- Which common operations does the Form require, and does the Host's support response include every required operation exactly once?
- Can the same UID's update or delete safely recover a partial resource? What does deletion not remove?
- Which exact Resource UIDs, Interfaces, Bindings, or artifacts are used, who owns each one, and what blocks deletion?
- Are private inputs truly optional or intrinsic to required behavior? Can values stay out of public records and logs?
- Which behavior is portable, and which environment constraints are part of the contract?
- Does a complete example obey every rule in the text, and can a Host author implement it without guessing?

For common HTTP requirements, use the [v2 overview](/en/spec/host-api/v2/), [HTTP API](/en/spec/host-api/v2/http), and [end-to-end examples](/en/spec/host-api/v2/examples). These shared documents define the wire; this document defines Form-specific meaning.


</div>
