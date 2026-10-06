---
# Generated from spec/host-api/v2/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/host-api/v2/README.md
canonicalUrl: /_source/host-api/v2/README.md.txt
sourceLanguage: en
releaseState: published
---

<div lang="en" class="specification-source">

# Takoform Host API v2

Takoform defines a common HTTP API for managing resources provided by different
Hosts. A **Form** defines what one kind of resource means: its inputs, observable
state, operations, and connections. A **Host** implements Forms and provides the
resources. A **client** selects a Form and a Host, then operates those resources
through the Host API.

The API identifier is `forms.takoform.com/v2`. A Form is identified separately by
the exact HTTPS URL at which its author publishes its specification. Knowing a
Form URL does not make a Host implement that Form.

## 1. Reading this specification {#reading}

This document, the [HTTP API](/spec/host-api/v2/http), and [Form requirements](/spec/host-api/v2/forms) are the
normative specification. Their English source text defines the requirements.
Translations and explanatory guides do not introduce different requirements.
Explicit requirements in normative prose are binding, including lower-case
`must` and `must not`; uppercase keywords emphasize, rather than create, that obligation.
The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**, when used
in uppercase, have the meanings described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174).

| Document | Purpose | Status |
| --- | --- | --- |
| This overview | Terms, resource model, responsibilities, and compatibility | Normative |
| [HTTP API](/spec/host-api/v2/http) | Fields, routes, authorization, concurrency, retries, errors, and optional features | Normative |
| [Form requirements](/spec/host-api/v2/forms) | What authors specify so independent implementations provide the same resource semantics | Normative; worked examples are identified as illustrative |
| [Examples](/spec/host-api/v2/examples) | Request/response walkthroughs and decisions after failures | Informative |
| [Migration](/spec/host-api/v2/migration) | Differences from v1 and questions for an explicit transition | Informative |

A client implementer should read the model below, follow the examples, and use
the HTTP reference for exact behavior. A Host implementer needs all three
normative documents and the exact Forms it implements. A Form author should
start with the Form requirements and use the HTTP reference rather than define
a second management protocol inside a Form.

Illustrative URLs use reserved example domains. They do not identify a running
service, a published Form, or an implementation that has passed testing.
Conformance does not require a particular SDK, schema language, programming
language, test program, database, or Terraform Provider.

## 2. Terms and responsibilities {#terms}

| Term | Meaning |
| --- | --- |
| **Form** | An author-published resource specification, identified by its exact version-specific HTTPS URL. |
| **Host** | A server implementing the common API and explicitly selected Forms. It owns execution, authorization, persistence, and recovery. |
| **client** | Software calling a Host: an application, CLI, SDK, or infrastructure Provider. |
| **principal** | A stable authenticated identity to which the Host applies permissions and replay scope. A credential identifies a principal; the credential itself need not be that identity. |
| **Space** | A Host-defined management scope containing named Resources, not a portable account or billing protocol. |
| **Resource** | The Host's durable record of one managed resource, identified by a Host-issued UID. |
| **Operation** | The durable identity and progress of one accepted create, update, or delete request. |
| **Offering** | An optional Host-defined choice of execution arrangements, limits, or terms for new Resources. |
| **Interface** | A Form-defined contract for using a resource, such as a runtime method or network protocol. |
| **Binding** | A Form-defined connection between resources, including how an Interface is presented and what permissions it requires. |
| **execution target** | The backend system in which the Host carries out a change; it may be local or external. |

### Specification and implementation

The Form author defines resource semantics. The Host implements those semantics;
it does not create them by installing a definition. A client can read a Form's
specification before selecting any Host.

```text
Form author ── publishes specification at an HTTPS URL ──► implementers and users

client ── common management API ──► Host ── implementation ──► execution target
```

Form publication does not deploy a resource, install code in a Host, or grant
permission. Hosts MUST NOT use a Form URL in a resource request as an instruction
to fetch or execute arbitrary remote code or definitions. Support comes from an
explicit implementation selected by the Host's operator. Existing resource
management and recovery MUST NOT depend on the author's documentation server
remaining available.

The common API owns wire formats, Resource and Operation identity, concurrency,
replay, errors, and secret-input handling. A Form owns resource-specific input,
output, behavior, references, and usage contracts. The Host owns implementation,
permissions, capacity, and execution arrangements. These specifications do not
select a particular cloud provider or implementation repository.

### Ownership and authorization

A Resource UID, Space name, Form URL, Offering ID, or reference is not an
authorization credential. The Host MUST authenticate and authorize requests
according to the [HTTP authorization rules](/spec/host-api/v2/http#discovery). Read access,
write access, and the right to use a referenced resource are distinct permissions
even when the resources share a Space.

The API does not prescribe whether an organization, one individual, or another
Host-defined principal owns a Resource. The Host's authentication documentation
explains its ownership boundary and how credential replacement affects access
and replay identity. A Host can serve one owner and one Space; a shared
multi-user service and a Space-creation API are not prerequisites.

## 3. Form identity and technical support {#forms-and-support}

A Form URL is an absolute HTTPS URL serialized as ASCII, without user
information, query, or fragment. The full string is its identity. Hosts and
clients MUST NOT infer equivalence through redirects, case conversion, trailing
slash insertion, similar names, or version-number comparisons. See
[common format](/spec/host-api/v2/http#common-format) and [Form requirements](/spec/host-api/v2/forms).

These are four separate facts:

1. **A specification exists.** Its author has published the Form.
2. **A Host implements it.** The Host reports support for the exact URL.
3. **A request is admissible.** The caller, input, references, Offering, and
   supply conditions satisfy the current checks.
4. **The resource is usable.** Observed state meets the Form's conditions for
   the intended use.

The [Support response](/spec/host-api/v2/http#support) answers the second question, not all
four. Supported Forms can still reject unauthorized requests, invalid inputs,
unavailable dependencies, or requests exceeding declared limits. Support MUST
NOT conceal a missing mandatory operation or different resource semantics.
Accepting the same JSON shape is not sufficient to claim an implementation.

Optional API capabilities are declared separately. A Form with valid
secret-free instances can be supported by a Host without `privateInputs` if
those instances satisfy the Form's required behavior. A Form whose required
behavior inherently needs secret inputs cannot be supported by that Host.
This explicit capability distinction is not permission to omit arbitrary Form
behavior. The [Support rules](/spec/host-api/v2/http#support) define the precise checks.

## 4. Resource identity and state {#resources}

A Resource is a management record, not proof that its execution target exists
or is reachable. It contains three different views, whose contents the Form
defines:

| Field | Meaning |
| --- | --- |
| `spec` | The accepted configuration requested by the client. |
| `observed` | State established by the Host at the execution target. |
| `output` | Values used to consume the resource, such as a connection address. |

The [Resource representation](/spec/host-api/v2/http#resources) defines the surrounding common
fields. A UID is unique within its Host and never reused, including after
deletion. Within a Space, names are unique across Forms. Recreating a deleted
resource with the same name therefore produces a different UID; old requests
cannot accidentally address the replacement.

The UID's Form URL, Space, name, and selected Offering do not change through
ordinary updates. Updating `spec` does not implicitly migrate a Resource to
another Form, Offering, or execution target.

### Accepted and observed generations

`generation` starts at 1 and advances when a new update or delete is accepted.
Execution failure does not roll it back. `observedGeneration` identifies the
latest generation confirmed to have been realized, or 0 before confirmation.
`observedAt` identifies the last actual observation, not the time a client last
fetched the management record.

A Resource can have `generation: 3` and `observedGeneration: 2` while its third
change is running or has failed. Returning the new `spec` does not allow the
Host to label the previous observation as generation 3. Forms can define
additional per-component observations where necessary.

| Resource phase | Management meaning |
| --- | --- |
| `pending` | An accepted create or update has not completed. |
| `idle` | The latest operation succeeded and no operation is executing. |
| `deleting` | An accepted deletion has not completed; the record and name remain occupied. |
| `error` | An operation failed; accepted input and known state remain available for recovery. |

None of these phases, including `idle`, is a universal application-health
signal. If a Form claims usage properties such as readiness, replication, or
TLS availability, it MUST define how those properties are observed. The Host MUST NOT invent a
guarantee that the Form does not define or that it has not measured.

## 5. Operations, concurrency, and recovery {#operations}

Every accepted create, update, and delete has an Operation, even if execution
finishes before the response. The Operation identifies its Resource UID,
action, accepted generation, current status, and effect at the execution target.
A successful HTTP exchange is not necessarily a successful Operation.

```text
request → validation and authorization → durable acceptance → execution
                                               │                 │
                                               └── Operation ────┘
                                                      │
                                 observation / result / reconciliation
```

Before modifying an execution target, the Host MUST durably retain acceptance
and the correspondence among Resource, Operation, and replay key. These records
survive Host restart. The API does not mandate a database engine, message queue,
locking primitive, or table layout.

Updates and deletes use the expected current generation. If another request has
changed it, the Host reports a conflict rather than silently overwriting that
change. At most one accepted, unfinished modification exists per Resource.
Reading a Resource or Operation does not start another modification or make
polling a prerequisite for execution.

### Replay is not new intent

A client chooses one `Idempotency-Key` for each intended operation. After losing
a response, it retries with the original key and original request. Within the
[retention contract](/spec/host-api/v2/http#retry), the Host returns that Operation's current
state. A different key expresses new intent; it is not a way to bypass an
uncertain result.

Authentication and authorization still apply on replay. Replay scope is bound
to a stable principal and cannot reveal another caller's result. Changing JSON
object key order alone does not change intent; array order, values, and field
presence can. The HTTP reference defines exact comparison and expiry rules.

### Uncertainty is not absence

The Host distinguishes an operation never sent, a known result, and a request
that may have reached its target with no confirmed outcome. `effect:unknown`
remains nonterminal and is reconciled against the original target and identity.
A timeout, process crash, or isolated 404 MUST NOT be treated as proof that no
external change occurred.

Known partial changes remain associated with the same Resource. After a
terminal failure, a Form MUST define how an explicit update or deletion of that
UID converges or cleans up known partial state. Recovery does not authorize
deletion outside the Form's ownership boundary.

The API does not promise exactly-once effects from a target that provides
neither safe retry nor result reconciliation. If the outcome cannot be
established, the Host retains the unresolved Operation and explains the
uncertainty instead of creating another resource with a different identifier.

## 6. Optional capabilities {#capabilities}

Discovery declares the Host's capabilities. The HTTP reference specifies their
routes and failure responses. Missing support is not permission to accept and
ignore a capability's input.

| Capability | What it adds | What it does not imply |
| --- | --- | --- |
| `offerings` | Explicit selection of an execution arrangement and revision at creation. | Capacity reservation, payment consent, or automatic migration. |
| `previews` | Side-effect-free validation advice. | A required admission token, guaranteed success, or permission to skip later checks. |
| `privateInputs` | Confidential values separate from public configuration, with replenishment for existing Operations. | An authentication protocol or permission to expose secrets in public state. |

If a Host uses Offerings, creation requires an explicit choice and expected
revision. The Host does not silently substitute a different choice when terms
change. Existing Resource identity and execution correspondence remain valid
if an Offering disappears from the new-resource list. See
[Offerings](/spec/host-api/v2/http#offerings) for update and cleanup behavior.

A preview is advice. Direct create, update, and delete remain the normal path.
The actual request repeats the relevant checks; a preview does not reserve a
name or authorize spending.

### Secret values

`privateInputs` supplies Form-defined confidential strings, not credentials
used to authenticate to the Host. Clients need a secret-input path rather than
copying these values into ordinary public configuration or state.

Hosts MUST NOT return private values in Resources, Operations, observations,
outputs, preview responses, diagnostics, or ordinary logs. They may retain
encrypted, time-limited execution inputs for asynchronous work and restart
recovery. A target's stored secret and the Host's temporary transport copy are
different things. Cryptography, storage, key management, and backup mechanisms
are Host responsibilities, not a required shared secret-management product.

Temporary values and the confidential material used to compare replays have
different lifetimes. If an unsent step loses its temporary input, the Host can
wait for the original value on the same Operation. Replenishment cannot change
intent or settle uncertain external effects. See
[private inputs](/spec/host-api/v2/http#private-inputs) for the complete rules.

## 7. Usage contracts and resource connections {#usage-contracts}

Management and runtime usage are separate contracts. A storage Form can define
a network data plane; a compute Form can define a programming ABI; a Binding
can present one resource's Interface inside another. These contracts belong to
the Form or an exact external specification it references.

An Interface or Binding does not need a separate package, global registry, or
independent version stream. A Form can define it in its own specification.
A reference alone does not transfer ownership, supply credentials, or authorize
action on another resource.

The Form MUST define dependency and deletion semantics: what it references,
whether references remain fixed or are re-resolved, who owns each resource,
what operations are permitted while it is in use, and what deletion removes.
The API does not infer cascade deletion from a connection or shared name.
The Host applies both the Form's rules and the caller's permissions.

The common API has no universal code-upload or data-transfer route. Forms that
need bundles, images, migrations, or initial data define their transfer,
validation, authorization, and retention requirements. Publishing a Form
specification and distributing application artifacts are different actions.

## 8. Publication and compatibility {#compatibility}

A Form author MUST publish human-readable normative specifications at the
identity URL. Machine schemas, generated types, SDKs, or signatures can assist
implementations but are not prerequisites. Optional schemas do not silently
override normative behavior.

HTTPS provides a location and transport protection; a URL alone is not
cryptographic proof of past document bytes. Authors maintain the meaning of
version-specific URLs. Implementers may keep copies, compare revisions, or use
optional signatures. Takoform does not require package distribution,
transparency logs, central registration, or an installation transaction before
a specification exists.

| Versioned item | Identity and compatibility responsibility |
| --- | --- |
| Common API | The API major, here `forms.takoform.com/v2`. Changing published protocol meaning requires another major. |
| Form | The author's exact version-specific URL. A changed contract requires a new identity rather than reinterpreting the old one. |
| Library | Its own software release version; updating it does not redefine an API or Form. |
| Provider | A software release version for client mappings, with no privileged protocol status. |

Layout, navigation, translations, and informative explanations can improve
without a separate specification-version stream. A normative behavior change
must not be concealed as an editorial clarification. SemVer-looking Form URLs
do not acquire automatic compatibility or aliasing rules from the common API.

## 9. Conformance claims {#conformance}

Common-API conformance and Form conformance are distinct. Hosts MUST implement
mandatory HTTP operations with their authorization, identity, concurrency,
replay, and recovery semantics. Each advertised optional capability must meet
its full contract. Each supported Form must meet its mandatory resource
semantics.

The [HTTP conformance requirements](/spec/host-api/v2/http#conformance) include concurrency,
response loss, Host-process restart with the same durable state, partial
effects, and secret-input failures where applicable. Recreating handles in a
running process does not establish recovery after process termination. The
specification requires the behavior, not a particular test framework.

Common-API tests do not qualify every Form or backend. A management operation
does not prove application health. An implementation report should identify
the API, exact Form URLs, optional capabilities, and execution arrangements it
tested, without treating source publication or a test double as evidence of a
deployed service.


</div>
