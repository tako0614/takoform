---
title: Implementing Host API v2
description: Design the durability boundary that keeps Resources, Operations, and retry records coherent across restarts.
prev:
  text: Guides by role
  link: /guides/
next:
  text: Specification overview
  link: /spec/host-api/v2/
---

# Implementing Host API v2 {#host-api}

This is design guidance, not a reference Host implementation. A v2 Host manages more than HTTP responses: it owns accepted work, Resource generations, and the state verified at its execution target. This guide focuses on the durability boundary, then shows how to check a running Host against the Takoform repository's baseline probe. The [HTTP API](/spec/host-api/v2/http) is the source for exact paths, statuses, and retention requirements.

## Make acceptance one durable fact {#acceptance}

After authentication and authorization, look up the Idempotency-Key before any acceptance check. The same key with the same request, private inputs included, returns the original Operation's current state; a different request under that key gets `409 idempotency_conflict` without effects; and if the Host has lost the comparison material for its private inputs, which is a Host retention failure, it answers `409 private_inputs_unverifiable` naming the original `operationId`.

Only for a new key, check Form support, the Offering selection, input, references, that the name is free (create) or the generation is current (update, delete), and that no other mutation of the UID is unfinished, then accept. Run first, those checks would refuse a lost-response replay of an accepted change with `409 generation_conflict`, `409 name_conflict`, or `409 resource_busy`. On acceptance, persist the Resource and Operation together with the Idempotency-Key mapping as one durable acceptance. Concurrent requests must converge on one winner; do not allow partial records such as an Operation without its Resource, or a backend change without its replay record.

At minimum, retain enough information to identify and resume the original request after restart:

- Stable principal, API version, Idempotency-Key, and the method, path/query, generation condition, and JSON value needed to match a retry, plus private-input comparison material kept apart from the values themselves.
- Host-issued Resource UID, Form URL, Space, name, accepted desired `spec`, and current generation.
- Operation ID, action, generation, status/effect, acceptance time, and retention deadline.
- Execution state bound to that Operation and the backend identity needed to verify its outcome.

The key scope is `(Host, API version, stable principal, key)`. Do not discard unfinished Operations or unknown effects at an ordinary retention deadline. The common contract does not choose a database, queue, ORM, or encryption scheme. It requires durability and concurrency control that preserve these associations.

## Bind execution to the original Operation {#dispatch}

The HTTP handler and backend work may have different lifetimes. If work continues in a separate worker, provide a durable notification or equivalent recovery path that can resume accepted Operations. Duplicate delivery and restart must continue the original Operation—not create a new UID, Operation, or backend object. While an effect is unresolved, reject another mutation on that UID as `resource_busy`.

`GET /operations/{id}` reads current recorded state. It does not resend Create/Update/Delete or start reconciliation merely because a client polled. Background execution advances work independently. Resource GET returns the last verified `observed`, `observedGeneration`, and `observedAt`. An implementation may perform read-only refresh during GET, but it must not start effectful work or label unverified values as observed.

## Recover at each restart or lost-ack point {#recovery}

Before sending any request that can change the backend, durably record that the Operation has left `queued`; recording `running` is the simplest way, and any marker written before the send works if the Operation is never reported as `queued` afterwards. [`queued`](/spec/host-api/v2/http#operations) means the next step has not been sent, and a crash never proves that nothing was sent, so a restarted Host must not restore `queued` for a step that may have been sent. That dispatch record decides between the second and third rows below: without it, the next step was not sent; with it, the step may have been, and the Host moves the Operation to `reconciling`, through `running` if it is still recorded as `queued`, as it also does after backend success when neither the backend result nor the terminal status was recorded.

| Failure point | Durable state and recovery action |
| --- | --- |
| Before acceptance is recorded | No Operation or backend effect was accepted. Revalidate the request; if accepted, create the durable record once. Requests arriving with the same key converge on that record. |
| After acceptance, before the dispatch record | Restore `queued/effect:none` and the original dispatch data, then advance that Operation. Do not reissue a UID or key. |
| After the dispatch record, before the backend result is recorded | The backend request may have been sent. Do not assume execution never happened. Set `reconciling/effect:unknown` and check using the saved backend identity. Block a new mutation until the result is established; a timeout alone cannot mean `failed/effect:none`. |
| After backend success, before terminal state is recorded | Reconcile or read back the backend, then advance the original Operation when success is verified. Do not create a second Operation to repeat the successful effect. |

If only the client acknowledgement was lost and the Host's acceptance record remains, replaying the same request with the same key returns the same Operation's current state. If authorization has been revoked, the Host may hide that state with `403` or `404`.

## Keep success separate from observation {#observation}

An Operation reports progress and effect for one Form-defined management action. `succeeded/effect:complete` means that action completed; it is not a general service-health result. Keep the accepted desired value in Resource `spec` and update `observed` only with values verified at the backend. After failure, preserve the Resource and any known partial-effect mapping so the Form's same-UID Update/Delete recovery remains possible.

Once these obligations are met, the choice of worker, database, and queue arrangement belongs to the Host. Follow the [HTTP API contract](/spec/host-api/v2/http) for normative statuses, retention, `404`/`410`, and problem details.

## Check your Host against the baseline {#check}

[Section 10 of the HTTP API](/spec/host-api/v2/http#conformance) lists what a Host must demonstrate through its public API. The Takoform repository includes a [baseline probe](https://github.com/tako0614/takoform/tree/main/conformance/v2) that drives one mandatory lifecycle against your Host and stops at the first response it does not accept. It is a development check, not a certification: a pass covers the steps it ran, for one Form, through the transport you supply. For each Section 10 obligation:

1. **Exact Form support**
   - Probe checks: `support` for your Form and for a Form URL you do not implement, and that Create with that URL returns `422 unsupported_form`.
   - You demonstrate: the Host never fetches an unsupported URL.
2. **Same UID and generation rules**
   - Probe checks: Create, read, list, update, and delete of one Resource, with generations 1, 2, and 3 on the same UID, then `404` or `410` and removal from the list.
   - You demonstrate: the same rules for your other Forms.
3. **Keys, generations, and principals**
   - Probe checks: same-key replay returns the original Operation; a changed body under that key returns `409 idempotency_conflict`; a stale generation returns `409 generation_conflict` and changes nothing.
   - You demonstrate: [concurrent requests with matching keys, and isolation between principals](#isolation-experiment).
4. **Response loss and process restart**
   - Probe checks: nothing.
   - You demonstrate: the [restart experiment](#restart-experiment) at the last three points in [Recover at each restart or lost-ack point](#recovery).
5. **Partial failure**
   - Probe checks: nothing.
   - You demonstrate: with [fault injection](#restart-experiment), that partial effects stay visible and recoverable on the same UID.
6. **Optional features**
   - Probe checks: when advertised, that your selected Offering is listed and kept; with private inputs, that Discovery and `support` both declare them.
   - You demonstrate: each advertised feature's refusal, retry, and secret non-disclosure rules.

Along the way it also checks the Discovery, Operation, and Resource shapes, `Location` and `Retry-After`, response media types, and that each finished Operation's `retainUntil` is at least the advertised replay window after its last update.

### Run the probe {#run-check}

The probe is a JavaScript module without a CLI or dependencies; it has been run with Node.js 22 and 26. It never looks up credentials: you pass a `transport` function that performs each request and adds your Host's authentication. It accepts only an HTTPS origin, such as `https://localhost:8443`, so put a local Host behind TLS before checking it.

Choose a Space you can safely write to, because the probe creates, updates, and deletes a real Resource. The fixture's `form` must support create, read, update, and delete on your Host; `unknownForm` must be a URL it does not implement. The example below uses the fictional [KeyValueEntry Form](/spec/host-api/v2/forms#key-value-entry). Its specification is complete, so a Host in development can implement it as specified and run this check before it implements the Forms it will offer. No author publishes its URL, so claim support for it only on a Host used for testing.

Clone the repository, save the following as `check-host.mjs` at its root, and replace the commented values:

```console
git clone https://github.com/tako0614/takoform.git
cd takoform
```

```js
import { runHostApiV2 } from "./conformance/v2/host-api.mjs";

const suffix = Date.now();
const token = process.env.HOST_TOKEN;
const result = await runHostApiV2({
  origin: "https://host.example", // your Host's bare HTTPS origin
  fixture: {
    disposable: true, // the probe creates, updates, and deletes it
    // A Form your Host supports, and one it does not implement:
    form: "https://forms.publisher.example/key-value-entry/1.0.0",
    unknownForm: "https://forms.publisher.example/unknown/1.0.0",
    space: "conformance", // a Space this credential may write to
    name: `baseline-${suffix}`,
    // A spec that is valid for that Form:
    spec: { key: `baseline-${suffix}`, value: "hello" },
    // Required when the Host advertises Offerings:
    // offering: { id: "standard", revision: "1" },
  },
  pollDelayMs: 1000,
  // Discovery is unauthenticated; this Host uses Bearer elsewhere.
  transport: (request) => fetch(request.url, {
    method: request.method,
    headers: request.authenticated
      ? { ...request.headers, Authorization: `Bearer ${token}` }
      : request.headers,
    body: request.body === undefined
      ? undefined
      : JSON.stringify(request.body),
    signal: request.signal,
    redirect: "manual",
  }),
});
console.log(result);
```

```console
HOST_TOKEN=<credential> node check-host.mjs
```

If your Host's certificate is self-signed or issued by a local certificate authority, Node.js may reject it even when your operating system trusts it, because builds from nodejs.org use their own list of certificate authorities by default. The run then stops at `discovery`. Name the self-signed certificate, or the authority's certificate, as a PEM file when you start Node.js:

```console
NODE_EXTRA_CA_CERTS=<path to the PEM certificate> HOST_TOKEN=<credential> node check-host.mjs
```

If your Form needs private inputs, add `privateInputs` (a map of strings) to the fixture; the run stops at `fixture` unless Discovery and `support` both declare the capability.

After its create, update, and delete, the probe reads each Operation until it finishes, for at most `maxPolls` reads (10 by default, up to 100). Before each read it waits for the `Retry-After` on the response before that read, such as the `202` or a `429` `rate_limited` Problem that refused a read, and 1 second after a `429` without one. It never waits more than 60 seconds, so a Host that asks for longer is read sooner, and between reads it waits at least `pollDelayMs` (in milliseconds, 0 by default). A refused read counts toward `maxPolls`, and the run fails if reads are still refused at that bound. A `429` on any other request ends the run, so give the test credential a rate limit that allows the probe's back-to-back requests. With the defaults the probe sleeps at most ten minutes for each change, and `timeoutMs` (10000 by default) limits each request. Raise `pollDelayMs` or `maxPolls` for a Host whose Operations take longer than a few seconds.

### Read the result {#check-result}

A passing run prints what the baseline did not cover:

```text
{
  baseline: 'passed',
  fullConformance: false,
  gaps: {
    restart: 'not-tested',
    faultInjection: 'not-tested',
    concurrentRequests: 'not-tested',
    crossPrincipal: 'not-tested',
    optionalFeatures: 'not-tested',
    formSpecific: 'not-tested'
  }
}
```

A failing run throws at the first broken step and names the step and the rule, for example `v2 HTTP baseline create-replay: same key created another Operation`. Messages never include response bodies or credentials. `v2 HTTP baseline discovery: transport, status, or body failed` on the first step usually means the request never completed: check the origin, TLS certificate, and network before the API. If a run stops partway, the disposable Resource may remain; delete it through your Host's API.

`fullConformance` is always `false`. Treat `gaps` as the remaining Section 10 work: the [restart experiment and fault injection](#restart-experiment) below, [concurrent and cross-principal requests](#isolation-experiment), every optional feature you advertise, and each Form's own behavior. To check a Form's results as well, add `expectedSpec` or an `assertResource(resource)` function that returns `true` to the fixture.

### Demonstrate restart and partial failure {#restart-experiment}

The probe cannot stop your Host's process, so obligations 4 and 5 need a test you run yourself. Give a test build of your Host a hook that stops the process at a chosen point, for example an environment variable naming the step after which it exits. Section 10 requires a real process restart: rebuilding a handle inside the same process does not count.

Section 10 names three restart points, the last three rows of [Recover at each restart or lost-ack point](#recovery): right after acceptance is recorded, after the backend request may have been sent, and after backend success but before the terminal status is recorded. For each point, and for create, update, and delete:

1. Send the request with a key you record and stop the Host at that point. If your Host already answered `202` before dispatching in the background, discard that response as if it were lost.
2. Start a new Host process.
3. Resend the identical request with the same key, within the replay window.
4. Check that the replay returns the same Operation ID and Resource UID, and that restart and replay produced no second backend object, no object under another name, and no repeated effect.
5. Until the Operation is terminal, a different mutation on that UID, sent with a new key and the current generation, gets `409 resource_busy`. After the restart at the after-acceptance point, the Operation is `queued` with `effect: none` until the Host dispatches it; at the two later points it is `reconciling` with `effect: unknown` until the Host has verified the backend result (at the last point, unless the Host had recorded the backend result). Have the test build hold dispatch and readback after the restart so you can observe these states.
6. Follow the Operation to its end and compare the Resource's `observed` with the backend. After a delete, the Resource returns `404` or `410`, it is gone from the list, and the backend object is gone.
7. Restart once more after the terminal status is recorded and confirm the Operation is unchanged.

While the Operation is `reconciling` at the two later points, step 6 can finish only as KeyValueEntry's [unknown-result rule](/spec/host-api/v2/forms#lifecycle-and-recovery), or your Form's equivalent, allows: a matching readback at a backend identity safe for this exact Operation confirms success; resending or failing needs an idempotency or fencing mechanism that makes the same-identity action safe (for example, a write ID the backend deduplicates, or a fence that excludes a delayed writer), or proof that the write was never dispatched and cannot later act. If the backend offers none of these, the Operation correctly stays `reconciling` with `effect: unknown`, with an explanation, for example in `error`, until an operator establishes the outcome. Check instead that it is unchanged after another restart, that other mutations on the UID still get `409 resource_busy`, and that it left no second object.

Repeat the stops without step 3 as well: the restarted Host should resume the accepted Operation on its own, as [Bind execution to the original Operation](#dispatch) describes. Without the create's response you have no IDs, so list the Resources by Space and name and read the Operation the Resource's `lastOperation` names.

For partial failure, use a Form that defines a partial result, such as the [RenderedGreeting Form](/spec/host-api/v2/forms#rendered-greeting) and its `snapshot_incomplete` code (its unsigned mode needs no private inputs; its source is a KeyValueEntry). The KeyValueEntry Form defines no partial result. Make the backend fail after it has changed part of what one Operation manages. Once the Host has proven which part changed and, where the Form requires it (RenderedGreeting does), fenced the writer so that part cannot change again, the Operation ends `failed` with `effect: partial`; until then it stays `reconciling` with `effect: unknown`. Once the Operation has failed, the Resource is in `phase: error`, and its `observed`, `output`, and `observedGeneration` do not claim the failed change. The Host's mapping to the partly changed object is internal, so show it through recovery: a PUT or DELETE on the same UID, as the Form defines, repairs or removes that object, and only then does the recovery Operation report `succeeded`. [Unknown backend result, proven partial effect, and same-UID cleanup](/spec/host-api/v2/examples#unknown-backend-result-proven-partial-effect-and-same-uid-cleanup) shows the HTTP exchanges for one such case.

### Demonstrate concurrency and principal isolation {#isolation-experiment}

The probe sends one request at a time with one credential, so the rest of obligation 3 needs tests you run yourself against a disposable Space. Send valid requests throughout, so that only the behavior under test can refuse them, and resend any `429` (after its `Retry-After`) or `503` with the same key.

For concurrency:

1. **Same request, same key.** Send ten copies of one create request in parallel, then ten copies of one update, then ten of one delete; all update copies share one key, all delete copies share another, and each batch carries the current generation. Wait for each Operation to finish before the next batch. Every answer in a batch names the same Operation, and for create the same Resource UID; the generation advances once per change; the backend never holds a duplicate object, and holds none after the delete. The Host checks the key before the generation, so a copy that arrives after acceptance still gets the original Operation rather than a generation conflict.
2. **Different bodies, one key.** Send two valid create bodies that differ only by name under one new key at once. One is accepted; the other gets `409 idempotency_conflict` with no effect.
3. **Two updates, one Resource.** Send two updates at once, each with its own key and the same `Takoform-Expected-Generation`. Exactly one is accepted and the generation rises by exactly 1; the other gets `409 resource_busy` or `409 generation_conflict` with no effect. To see `resource_busy` on its own, send a new-key update at the current generation while the accepted update is still unfinished.
4. **One key, another path.** Reuse a create's key for an update of the Resource it created. The request differs, so it gets `409 idempotency_conflict`.

For principals, use credentials for two different stable principals, A and B. A single-owner Host with one principal can skip items 1 and 2.

1. **Same key, other principal.** Create a Resource as A with a key you record, then send A's identical request as B with the same key. B's request is judged in B's own key scope: it never returns A's Operation and never gets `idempotency_conflict`. Without access to A's Space, expect `403` or `404`; in a shared Space, expect `409 name_conflict`. Then send that key with a create into a Space and name B may use; B gets its own new Operation and UID.
2. **Reading and changing across principals.** As B, read, list, update, and delete A's Resource, and read its Operation. Unless B is authorized for it, reads return `403` or `404`, the list neither includes it nor reveals it through counts or cursors, mutations are refused with the generation unchanged, and no response body carries A's Resource information.
3. **Rotation and revocation.** Rotate A's credential as the Host's authentication documentation describes and, within the replay window, confirm that A's replay still finds its Operation. Then revoke A's authorization for the Space while keeping the credential valid: a replay gets `403` or `404` without revealing the earlier result.
