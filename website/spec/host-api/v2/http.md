---
# Generated from spec/host-api/v2/http.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/host-api/v2/http.md
canonicalUrl: /_source/host-api/v2/http.md.txt
sourceLanguage: en
releaseState: published
---

<div lang="en" class="specification-source">

# Host API v2 — HTTP API

This is the normative HTTP, lifecycle, concurrency, and retry contract for Takoform Host API v2. The
[overview](/spec/host-api/v2/) introduces the model; [Form requirements](/spec/host-api/v2/forms) define resource-specific
contracts; [examples](/spec/host-api/v2/examples) are non-normative request/response illustrations. Normative prose here
is binding: “must” and “must not” state conformance requirements regardless of capitalization. Uppercase
BCP 14 terms used for emphasis elsewhere in the normative v2 documents do not make lowercase obligations
optional. “May” identifies an implementation choice. The JSON shapes below use TypeScript-like notation.

A client discovers a Host, checks support for an exact Form URL, submits a resource change, and follows the
returned Operation. Acceptance of an Operation is distinct from completion and from application availability.

### Endpoint index {#endpoints}

`{root}` is the discovered `baseUrl`. Append the listed path suffix literally, including its leading `/`.

| Purpose | Method and path | Availability |
| --- | --- | --- |
| [Discovery](#discovery) | `GET /.well-known/takoform/v2` | Required |
| [Form support](#support) | `GET {root}/support` | Required |
| [Offerings](#offerings) | `GET {root}/offerings` | When `capabilities.offerings:true` |
| [Create Resource](#create) | `POST {root}/resources` | Required |
| [Read Resource](#read) | `GET {root}/resources/{uid}` | Required |
| [List Resources](#list-resources) | `GET {root}/resources` | Required |
| [Update Resource](#update) | `PUT {root}/resources/{uid}` | Required |
| [Delete Resource](#delete) | `DELETE {root}/resources/{uid}` | Required |
| [Read Operation](#operations) | `GET {root}/operations/{id}` | Required |
| [Replenish private inputs](#replenish-inputs) | `PUT {root}/operations/{id}/private-inputs` | When `capabilities.privateInputs:true` |
| [Preview](#previews) | `POST {root}/previews` | When `capabilities.previews:true` |

All successful bodies are JSON. This matrix identifies the successful body and status for each route;
[Section 9](#errors) applies to refusals and transport failures on every route.

| Route | Success | Principal pre-acceptance refusal or other outcome |
| --- | --- | --- |
| Discovery | `200 Discovery` | No authentication is required. |
| Form support | `200 Support`, including a negative support answer | A malformed `form` is `400 invalid_request`; unsupported is not a fetched Form. |
| Offerings | `200 Page<Offering>` | Unadvertised feature: `404 capability_unavailable`. |
| Create, update, delete | `202 Operation` while unfinished; `200 Operation` once settled | No Operation for a rejection before acceptance; see [errors](#errors). |
| Resource read | `200 Resource` | Unknown UID: `404`; a retained deletion marker may use `410`. |
| Resource list | `200 Page<Resource>` | Cursor expiry: `409 cursor_expired`. |
| Operation read | `200 Operation` | Unknown/expired record: `404` or `410`. |
| Private-input replenishment | `200 Operation` | Conflict, unverifiable inputs, or terminal Operation: `409` with the corresponding code. |
| Preview | `200 Preview` | Unadvertised feature: `404 capability_unavailable`. |

## 1. Scope and common format {#common-format}

The API identifier is `forms.takoform.com/v2`; the standard API root is `/apis/forms.takoform.com/v2`. A
minimal Host implements discovery, Form support, Resource create/list/read/update/delete, and Operation
read. Offerings, previews, and private inputs are independent optional capabilities. A Form specifies
resource-specific behavior; the common API specifies transport and lifecycle.

### HTTP and JSON

Public transport uses HTTPS. HTTP semantics follow [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) and
JSON follows [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259). Successful response bodies use
`application/json`; errors use `application/problem+json`. Authenticated responses and responses to
requests containing secrets carry `Cache-Control: no-store`. An HTTP redirect must not forward credentials
to a different origin.

- JSON is UTF-8. Reject duplicate object keys, invalid Unicode, and non-finite numbers.
- Every integer in this document is in `0..9007199254740991`. A counter at its maximum must not wrap.
- `id`, `uid`, `space`, and `name` match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, are case-sensitive, and occupy
  one URI path segment when used in a URI. Offering IDs and Operation IDs use the corresponding `id` grammar.
- Timestamps are UTC RFC 3339 strings ending in `Z`, for example `2026-10-04T12:00:00Z`.
- A Form URL is an ASCII-serialized absolute HTTPS URL with a nonempty hostname and no userinfo, query, or
  fragment. A publisher percent-encodes non-ASCII characters. Compare the entire URL string exactly: do not
  identify a Form by a redirect target, case conversion, or an added trailing slash.
- Reject unknown fields in common request envelopes and unknown or repeated query parameters with
  `400 invalid_request`. The Form defines treatment of unknown fields *inside* `spec`. A client may ignore
  unknown response fields, but must not interpret unknown states or actions as success. An extension must not
  alter this version’s required behavior.
- Only fields explicitly marked optional (shown with `?`) may be omitted. Omission and JSON `null` are
  different. The types below show every permitted `null` explicitly.

### Request and response headers

| Header | Where used | Contract |
| --- | --- | --- |
| `Content-Type: application/json` | Request with a JSON body | Identifies the body format. |
| `Idempotency-Key` | Create, update, delete | Required; syntax, matching, and retention are in [retry](#retry). |
| `Takoform-Expected-Generation` | Update, delete | Required decimal integer naming the current generation. |
| `Location` | Accepted mutation response | Absolute, same-origin `{root}/operations/{id}` URL. |
| `Retry-After` | `202` mutation response | Positive number of seconds before polling. Also follow it on `429`. |
| `Cache-Control: no-store` | Authenticated response or response to a secret-bearing request | Prevents response caching. |
| `WWW-Authenticate` | `401` response | Host’s authentication challenge. |
| `Allow` | `405` response | Allowed methods. |

Authentication credentials follow the Host’s declared scheme. Replenishing a private input continues an
existing Operation; it does not use a new idempotency key or generation.

## 2. Discovery and authorization {#discovery}

`GET /.well-known/takoform/v2` is unauthenticated and returns `200 Discovery`. It contains connection
metadata only, never a resource, user, or secret listing.

```typescript
type Discovery = {
  api: "forms.takoform.com/v2";
  baseUrl: string;
  documentation: string;
  authentication: { schemes: string[]; documentation: string };
  capabilities: { offerings: boolean; previews: boolean; privateInputs: boolean };
  limits: { maxRequestBytes: number; maxPageSize: number; replayWindowSeconds: number };
};
```

All fields are required. `baseUrl` is an ASCII-serialized absolute HTTPS URL on the discovery document’s
origin, without userinfo, query, fragment, or trailing slash. The standard root is recommended, but a Host
may choose another path or the origin root (`https://host.example`). Form each API URL by concatenating
`baseUrl` and the endpoint suffix beginning with `/`. Do not resolve that suffix as an origin-relative URL
or replace the last path segment. Append encoded query parameters only after concatenation. A Form
specification URL is never the Host API base URL.

| `baseUrl` | Resulting create URL |
| --- | --- |
| `https://host.example/apis/forms.takoform.com/v2` | `https://host.example/apis/forms.takoform.com/v2/resources` |
| `https://host.example/custom/api` | `https://host.example/custom/api/resources` |
| `https://host.example` | `https://host.example/resources` |

`https://host.example/api?tenant=x`, `https://host.example/api#v2`, `https://user@host.example/api`, and
`https://host.example/api/` are invalid `baseUrl` values. A client receiving invalid discovery must stop
rather than “repair” the URL and send authenticated requests to the result.

Both `documentation` values are absolute HTTPS URLs. `schemes` is a nonempty array of nonempty HTTP
authentication-scheme strings (for example `Bearer`). Only a Host contained within a local administration
boundary may declare `None`. `None` is not permission to expose unauthenticated writes to the Internet; the
Host operator constrains reachability. Credential enrollment, role hierarchies, and commercial terms are
Host-owned rather than part of this common wire protocol.

Each `limits` value is a positive integer. `maxRequestBytes` limits the UTF-8 octets of a JSON request
body, excluding HTTP headers and transfer framing; if the Host accepts a content-coded request, the limit
applies to the decoded JSON body. Support for compressed requests is not required. `maxPageSize` bounds
requested pages, and `replayWindowSeconds` is the minimum accepted-request replay period in
[Section 6](#retry). Changing advertised limits or capabilities does not shorten retention already promised
for accepted Operations or change a Form’s meaning.

The Host authenticates and authorizes every subsequent request. It checks Resource ownership and Space
access; a URL, name, Form, Offering, or reference to another Resource is not an authorization grant.
Operation read and private-input replenishment require at least the target Resource’s authorization. An
idempotency key must not expose another principal’s Operation. A Space is a Host-local management scope; a
single-owner Host may expose only one and need not offer Space creation or multi-user tenancy. A reference
within the same Space still requires authorization to its target.

## 3. Form support and Offerings {#support}

### Check Form support

`GET {root}/support?form={encodedFormUrl}` requires exactly one `form` query parameter and returns
`200 Support`. The returned URL equals the decoded query value exactly.

```typescript
type Support = {
  form: string;
  supported: boolean;
  operations: ("create" | "read" | "update" | "delete")[];
  privateInputs: boolean;
};
```

All fields are required. When unsupported, the Host returns `supported:false`, an empty `operations` array,
and `privateInputs:false`. When supported, `operations` lists exactly the operations required by that
Form and supported by the Host, each once; order has no meaning. A supported Form means those required
operations are implemented, not partially implemented. The common API does not infer a different Form's
required operation set from this array. If every valid instance of a Form intrinsically requires private
inputs and the Host cannot handle them, the Host must not report support. A Form with valid secret-free
instances may be
`supported:true` and `privateInputs:false` when the Host supports all other required behavior; that
combination does not claim support for its secret-bearing instances. It is not permission to claim partial
CRUD, Binding, or module behavior. Support is a technical declaration, not a capacity reservation or
authorization decision. The Host compares the exact URL with contracts it explicitly implements; it does
not automatically fetch or execute the URL supplied in this request. An author’s site going offline must
not prevent operation of existing Resources.

### List and select Offerings {#offerings}

A Host without Offerings advertises `capabilities.offerings:false` and omits `offering` from create input
and Resource responses. This does not imply a free service; the Host communicates authentication and
commercial terms separately. A Host with Offerings advertises `true` and requires an explicit selection on
*every* create. It must not silently choose among materially different terms.

`GET {root}/offerings?form=...&space=...` requires both query parameters and returns authorized candidates
in the [page envelope](#pagination), or an empty list.

```typescript
type Offering = {
  id: string;
  revision: string;
  form: string;
  label: string;
  description: string;
  termsUrl?: string;
};
type OfferingSelection = { id: string; revision: string };
```

The `Offering` fields except `termsUrl` are required. `id` uses the common ID grammar; `revision` is a
nonempty opaque Host-local string; `form` is the exact Form URL; `label` and `description` are strings. If
present, `termsUrl` is an absolute HTTPS URL. Change `revision` when the selection’s meaning changes,
including its Form, backend, limits, pricing or contractual terms, or the terms linked by `termsUrl`.
Matching a revision is not a reservation or a payment-consent mechanism.

On create, the Host checks the selection’s revision and authorization, returning `409 offering_changed` for
a mismatch. It does not silently change the price or backend of an existing Resource. The Resource retains
its selected terms and backend mapping. Removal from the new-Resource Offering list, or a changed
new-Resource revision, must not by itself block reading, deleting, or cleaning up a known partial failure
of an existing Resource. Updates still check authorization and supply limits but do not silently move to a
current Offering.

## 4. Resource {#resources}

A Resource is the Host’s durable management record, not proof that a backend object currently exists.

```typescript
type Resource = {
  uid: string;
  form: string;
  space: string;
  name: string;
  offering?: OfferingSelection;
  generation: number;
  observedGeneration: number;
  observedAt: string | null;
  phase: "pending" | "idle" | "deleting" | "error";
  spec: Record<string, unknown>;
  observed: Record<string, unknown>;
  output: Record<string, unknown>;
  lastOperation: string;
};
```

All fields except `offering` are required. The Host issues a globally unique `uid` and never reuses it
after deletion. `(space,name)` is unique across Forms. `name`, `space`, `form`, and any selected `offering`
are immutable for that UID; the Offering field is absent when Offerings are disabled and retained from
creation otherwise.

`generation` starts at 1 and advances by exactly 1 for each *accepted* new update or delete, including one
that later fails; it never rolls back. `observedGeneration` is the last generation verified to conform, or
0 before any such observation. Stale observation must not be presented as current. `observedAt` is the time
`observed` and `output` were last verified, or `null` before verification; a failed check must not falsely
refresh it. A Form may define finer observation timestamps inside `observed`. The Form defines the shapes
of `spec`, `observed`, and `output` and how to determine availability. A completed management Operation
does not imply that an application or external endpoint is available. `phase:idle` means the last Operation
succeeded and no Operation is running, not that the application is ready. `lastOperation` names the last
accepted Operation, which may become unreadable after its retention ends.

### Create {#create}

`POST {root}/resources` requires `Idempotency-Key` and a JSON `Create` body:

```typescript
type Create = {
  form: string;
  space: string;
  name: string;
  offering?: OfferingSelection;
  spec: Record<string, unknown>;
  privateInputs?: Record<string, string>;
};
```

`form` is an exact Form URL; `space` and `name` use the common grammar; `spec` is the Form-defined full
desired input. `offering` is required exactly when the Host advertises Offerings. `privateInputs` is
optional and subject to [Section 7](#private-inputs). Validate syntax, Form support, authorization,
Offering, input, and references before effects. On acceptance, durably assign the UID, reserve the name,
and record generation 1 and the Operation *before* changing the backend. A name already in use yields
`409 name_conflict`, never replacement of the Resource. Initial `phase:pending` and unobserved values use
the Form’s empty or undetermined shapes.

### Read {#read}

`GET {root}/resources/{uid}` returns `200 Resource` containing the management record and last verified
observation. A common Host need not query its backend on every GET. It may refresh observation read-only,
without starting a create/update/delete Operation, subject to any stronger Form freshness rule. Clients
compare `observedAt` and `observedGeneration`; the GET time is not necessarily the backend observation
time. An unknown UID returns `404`; a retained deletion record may return `410`. Neither proves absence of
an unresolved backend side effect.

### List {#list-resources}

`GET {root}/resources` returns Resources the caller may read in the [page envelope](#pagination). Optional
`space`, `name`, and `form` filters use exact equality and combine conjunctively. Counts and cursors must
not reveal unauthorized Resources.

### Update {#update}

`PUT {root}/resources/{uid}` requires `Idempotency-Key`, `Takoform-Expected-Generation`, and a JSON object
with required `spec` and optional `privateInputs`:

```typescript
type Update = {
  spec: Record<string, unknown>;
  privateInputs?: Record<string, string>;
};
```

`spec` replaces the whole desired spec; it is not a patch. The Form defines the meaning of fields omitted
*inside* `spec`. Omitting `privateInputs` preserves previously configured secret values rather than
deleting them. A Form must explicitly define any secret removal or rotation through public or private input.

Update never creates an unknown UID. Only one unfinished mutation per UID may be accepted. Another
unfinished mutation gives `409 resource_busy`; a stale generation gives `409 generation_conflict`. A new
key is a new update even if `spec` is unchanged; do not optimize away the Operation. Ordinary update does
not infer a Form or Offering migration or backend replacement.

### Delete {#delete}

`DELETE {root}/resources/{uid}` requires the same two headers as update and has no body. On acceptance,
increment generation and set `phase:deleting`; retain the management record and name reservation until
completion. Delete only what the Form declares owned. A referenced Resource that cannot be deleted yields
`409 dependency_conflict`; there is no implicit cascade or force delete. After success, remove the Resource
from lists and release its name, while retaining the Operation according to its retention contract. A
different key sent to an already deleted UID returns `404` or `410`; replaying the original key returns the
original Operation.

## 5. Operations and mutation responses {#operations}

Every accepted create, update, and delete has an Operation, regardless of execution speed. A mutation
response is `202` while unfinished or `200` if already settled, with the Operation as its body and
`Location` pointing to its absolute same-origin `{root}/operations/{id}` URL. `202` includes a
positive-seconds `Retry-After`. Do not use `201` or `204`. A rejection *before* acceptance is a
[Problem Details error](#errors), not an Operation response.

```typescript
type Operation = {
  id: string;
  resourceUid: string;
  action: "create" | "update" | "delete";
  generation: number;
  status: "queued" | "running" | "waiting_input" | "reconciling" | "succeeded" | "failed";
  effect: "none" | "unknown" | "partial" | "complete";
  createdAt: string;
  updatedAt: string;
  retainUntil: string;
  error?: { code: string; message: string };
  inputRequired?: { names: string[]; reason: "expired" | "unavailable" };
};
```

All fields except `error` and `inputRequired` are required. `id` is Host-issued; `resourceUid`, `action`,
and `generation` bind this Operation to one accepted mutation and never change. `createdAt` is acceptance
time, `updatedAt` tracks the recorded state, and `retainUntil` is the promised earliest end of
availability. `error` has required `code` and `message` strings when present. `inputRequired.names` is an
array of requested Form-defined private-input names, and `reason` identifies an expired or unavailable
transfer value.

`GET {root}/operations/{id}` returns `200 Operation`, or `404`/`410`. GET does not itself begin execution,
resend, or recovery; background progress may continue.

| `status` | Meaning and next action |
| --- | --- |
| `queued` | Accepted, not yet sent to the backend. |
| `running` | Execution in progress; a replay must not initiate another mutation. |
| `waiting_input` | A provably unsent step needs private inputs; [replenish](#replenish-inputs) the same Operation. |
| `reconciling` | A step may have been sent, but its result is unknown; reconcile against the original backend identity. |
| `succeeded` | The Form-defined management action completed; terminal. |
| `failed` | The action ended; `effect` states whether tracked side effects remain; terminal. |

`effect` describes effects on the Form-managed resource or data, excluding the Host’s management records,
name reservation, and generation change—even if the managed object and records share a database. `none`
means no managed side effect is established, `unknown` means effects cannot yet be determined, `partial`
means a known, tracked subset changed, and `complete` means the requested change completed. A timeout alone
never establishes `none`. `succeeded` has `complete`; `failed` has `none` or `partial`. Do not make
`unknown` terminal: retain `reconciling`. `error` is required for `failed`, optional for `reconciling`, and
absent in other statuses. It must not contain raw backend responses or secrets. `inputRequired` is required
only for `waiting_input`; its names are a subset of names in the original request.

| From | Permitted next statuses |
| --- | --- |
| `queued` | `running`, `waiting_input` |
| `running` | `succeeded`, `failed`, `reconciling`, `waiting_input` |
| `waiting_input` | `queued` |
| `reconciling` | `running`, `succeeded`, `failed` |
| `succeeded`, `failed` | None; terminal |

A restart must not return a terminal Operation to a nonterminal status or change its
ID/action/UID/generation. Before entering `waiting_input`, prove no step of uncertain dispatch remains.

A failed Resource remains in `phase:error` with its last `spec`, observations, and mapping to any partially
changed backend object. The Form must define recovery or cleanup by a subsequent explicit PUT or DELETE on
the *same UID*. Do not accept another Operation while an earlier effect is unknown. If a backend cannot
reconcile the result or safely replay the original command, remain `reconciling` with an explanation and
stop until an operator can establish the outcome. This API does not promise exactly-once backend execution
where that evidence is impossible.

## 6. Retry and retention {#retry}

`Idempotency-Key` matches `[A-Za-z0-9][A-Za-z0-9._:-]{15,127}`. A client chooses a fresh, sufficiently
random key for each new intent (a UUID string is suitable) and retains it only for replay of that intent.
The scope is `(Host, API version, authenticated stable principal, key)`. A principal is the user or
comparable identity derived from credentials, not the credential bytes. Do not reuse a key at another path
or UID. The Host explains in its authentication documentation how the stable principal remains identifiable
and authorized after credential rotation.

Request equality includes HTTP method, API-root-relative path, every query parameter, specified generation,
and JSON value. JSON whitespace and object-key order alone do not distinguish requests; array order,
strings, values, and omission do. Mathematically equal JSON numbers compare equal. Private inputs
participate in matching without exposing their values or comparison material. This contract does not
prescribe fingerprinting, encryption, or storage mechanisms.

After authentication and authorization, the Host checks an existing key *before* a fresh generation check
or backend dispatch. The same key and same request return the original Operation’s current state—never a
new Operation, UID, or backend object. A different request with that key yields `409 idempotency_conflict`
without effects. If authorization has been revoked, the Host may return `403` or `404` without revealing
the prior result.

Key registration and acceptance of the Operation/Resource are indivisible. Concurrent copies have one
winner. Lost responses, Host restarts, and duplicate queue delivery retain the same mapping. Do not
“recover” by creating a new backend object under another name without reconciling the original.

`replayWindowSeconds` is the *minimum* period from initial acceptance during which the original request can
be replayed. `retainUntil` is no earlier than that deadline. Do not discard unfinished Operations or
unknown effects at that deadline. After a terminal result, retain the Operation and replay match for at
least another full replay window measured from terminal transition, extending `retainUntil` accordingly.
Merely receiving a replay need not extend retention.

Clients record the initial send time and advertised replay window. If no response arrived, stop automatic
replay *before* that time plus the window. Afterward, reconcile Resource/Operation evidence; do not blindly
recreate with either the same or a new key while the original outcome is unknown. Detection of an old key
after its retention expires is not guaranteed; a Host still retaining it returns the original result. This
is not a promise of forever exactly-once execution.

A Host exposing more than one API for the same Resource maintains UID-level generation and execution
exclusion across those APIs, although each API version has its own idempotency-key scope.

## 7. Private inputs {#private-inputs}

`privateInputs` is a JSON object mapping Form-defined names to strings. Do not coerce nonstrings. Omit the
field when unused. Its presence, even as `{}`, requires both Host discovery and Form support to advertise
private-input capability; otherwise return `422 capability_required`. When both advertise it, the Form
defines permitted names, required values, and whether an empty object is valid. Unknown names or missing
required values give `422 invalid_spec`.

Never copy a private value into public `spec`, Resource, Operation, `observed`, `output`, normal logs,
preview output, errors, diagnostics, or ordinary public state. Do not expose a simple hash of it. The rule
includes request-body tracing. A Form’s durable secret stored at the backend is different from a Host’s
temporary value held for transfer. The Host may use expiring encrypted internal storage for asynchronous
execution and restart. Encryption method, database, exact lifetime, key custody, and backup are Host
choices, not a mandated product or cryptographic scheme.

### Replenish the same Operation {#replenish-inputs}

If a temporary value expires or becomes unavailable, `waiting_input` is allowed only for a step proven
*unsent* and only while the Host can privately compare replenishment with the original secret. Send
`PUT {root}/operations/{id}/private-inputs` with the **entire original private-input map**:

```typescript
type PrivateInputReplenishment = { privateInputs: Record<string, string> };
```

```json
{ "privateInputs": { "name": "same original value" } }
```

Do not change, add, or remove values. This is an input continuation, not a new intent: do not issue a new
`Idempotency-Key` or generation. Repeating identical replenishment returns the same Operation and never
starts separate execution. The Host checks authorization, equality to the original entire map, and
nonterminal status. Different values give `409 private_inputs_conflict`; inability to compare gives
`409 private_inputs_unverifiable`; a terminal Operation gives `409 operation_terminal`. Successful
replenishment returns `200 Operation`. The same inputs sent in another nonterminal status return only its
current `200` state, with no re-execution.

Keep private comparison material, distinct from the transfer value, for at least the replay period and
throughout an unfinished Operation. Expiration of a temporary transfer value must not discard it. Losing
comparison material through failure makes both ordinary replay and replenishment
`409 private_inputs_unverifiable`; include the known original `operationId` in the Problem response to an
authorized caller and create no new Operation. This is a Host retention failure, not normal expiry. If
effects can be established, end as
`failed`; otherwise remain `reconciling` until resolved. A regular Resource mutation cannot serve as secret
replenishment. A changed secret is a new explicit update intent.

## 8. Lists and optional features {#optional-features}

### Page envelope {#pagination}

Resource and Offering lists return `items` (an array of the corresponding type) and `nextCursor` (an opaque
string or `null`):

```typescript
type Page<T> = { items: T[]; nextCursor: string | null };
```

`nextCursor:null` ends the walk. Both fields are required.

| Query | Valid value | Default |
| --- | --- | --- |
| `limit` | Integer from 1 through `maxPageSize` | `maxPageSize` |
| `cursor` | The preceding response’s opaque `nextCursor` string | Start at the beginning |

Bind a cursor to the original filters, Space, and principal. Reusing it with changed conditions returns
`400 invalid_request`. Return items in ascending ASCII order by UID (by `id` for Offerings); each cursor
advances past the last identifier, without repeating an identifier across pages. A walk is not a snapshot
of all items at its start: concurrent creation or deletion can affect later pages, and a new item ordered
before the cursor may not appear. An expired cursor gives `409 cursor_expired`; restart at the first page.

### Preview {#previews}

A Host advertising `capabilities.previews:true` implements `POST {root}/previews` with a JSON body:

```typescript
type PreviewRequest =
  | { action: "create"; input: Create }
  | { action: "update"; uid: string; expectedGeneration: number;
      input: { spec: Record<string, unknown>; privateInputs?: Record<string, string> } }
  | { action: "delete"; uid: string; expectedGeneration: number };
type Preview = { valid: boolean; errors: { code: string; message: string }[] };
```

Every field shown without `?` is required. The Host checks syntax and authorization and returns
`200 Preview` describing input validity; `valid:true` requires an empty `errors` array. It may read
information, but creates no Resource, reservation, charge, Operation, or durable secret. Preview is advice,
never a required step or a voucher for a real mutation. A real mutation rechecks current input,
authorization, references, supply conditions, and conflicts. A route for an unadvertised optional feature
returns `404 capability_unavailable`.

### Data and code transfer

Application data transfer, executable-code upload, and runtime HTTP/WebSocket communication are outside
common CRUD. A Form that needs them defines the transfer or connection mechanism and its authorization.
Publishing a Form specification is distinct from distributing application code or data. An external
reference does not grant authority to fetch arbitrary URLs with credentials.

## 9. Errors {#errors}

Use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457). An API error body requires
`type:"about:blank"`, `title`, integer `status` equal to HTTP status, and stable `code`. Optional `detail`
is a secret-free explanation; `operationId` names an already accepted Operation only when known. It is
required on `409 private_inputs_unverifiable` when the Host knows the original ID and the caller is
authorized; it is otherwise omitted when unknown or inapplicable.
Do not infer success from unknown fields or states. A transport/proxy failure can be non-JSON and still
leave acceptance uncertain.

```typescript
type Problem = {
  type: "about:blank";
  title: string;
  status: number;
  code: string;
  detail?: string;
  operationId?: string;
};
```

| HTTP | `code` | Caller action |
| --- | --- | --- |
| 400 | `invalid_request` | Correct common syntax, envelope, query, or cursor binding. |
| 401 | `unauthenticated` | Authenticate using the Host scheme; Host supplies `WWW-Authenticate`. |
| 403 | `forbidden` | Recheck authority; do not retry automatically. |
| 404 | `not_found` / `capability_unavailable` | Check identity or optional capability. |
| 405 | `method_not_allowed` | Use a method from `Allow`. |
| 409 | `name_conflict` / `generation_conflict` / `resource_busy` | Read the existing Resource/Operation. |
| 409 | `idempotency_conflict` / `offering_changed` / `dependency_conflict` | Reconcile content and decide a new intent. |
| 409 | `private_inputs_conflict` / `private_inputs_unverifiable` / `operation_terminal` | Follow [private-input rules](#private-inputs); do not auto-create. |
| 409 | `cursor_expired` | Restart the list from its first page. |
| 410 | `gone` | Deleted or retention ended; not proof of no backend effect. |
| 413 | `request_too_large` | Compare the Host’s advertised limit. |
| 415 | `unsupported_media_type` | Send `application/json`. |
| 422 | `unsupported_form` / `invalid_spec` / `capability_required` | Check the Form and advertised support. |
| 428 | `expected_generation_required` | Supply `Takoform-Expected-Generation`. |
| 429 | `rate_limited` | Follow the Host’s `Retry-After`. |
| 503 | `temporarily_unavailable` | Keep the original key and follow [retry](#retry). |
| 500 | `internal_error` | Acceptance may be unknown; reconcile with the original key. |

A Form-specific reason may appear in `detail` or `Operation.error` without changing these
management-failure classes. `500`, `503`, a broken connection, or an HTTP proxy’s answer alone never proves
non-acceptance. Never return raw internal exceptions, credentials, private values, or another principal’s
Resource information.

## 10. Conformance {#conformance}

At minimum, a Host must demonstrate through its public API that it:

1. Declares exact Form support and all required operations; rejects an unsupported URL without fetching it.
2. Creates, reads, updates, and deletes with the same UID and generation rules.
3. Distinguishes concurrent matching keys, conflicting key reuse, stale generations, and different principals.
4. Survives response loss and *Host-process restart* immediately after acceptance, after possible backend
   dispatch, and after backend success, reconciling from the same durable state. Reconstructing a handle
   inside one process does not substitute for restart.
5. Retains and exposes partial failure, then recovers or cleans it up by update or delete of the same UID
   instead of hiding an orphan as success.
6. For each advertised optional feature, also satisfies its refusal, retry, and secret non-disclosure rules.

Common API conformance covers the rules above. Conformance to a particular Form is measured separately
against that author’s exact specification.


</div>
