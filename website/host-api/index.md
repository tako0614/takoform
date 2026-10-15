---
title: Implementing Host API v2
description: Design the durability boundary that keeps Resources, Operations, and retry records coherent across restarts.
---

# Implementing Host API v2 {#host-api}

This is design guidance, not a reference Host implementation. A v2 Host manages more than HTTP responses: it owns accepted work, Resource generations, and the state verified at its execution target. This guide focuses on the durability boundary, then shows how to check a running Host against the repository's baseline probe. The [HTTP API](/spec/host-api/v2/http) is the source for exact paths, statuses, and retention requirements.

## Make acceptance one durable fact {#acceptance}

Before dispatching a mutation, validate authentication and authorization, Form support, input, references, and generation conditions. On acceptance, persist the Resource and Operation together with the Idempotency-Key mapping as one durable acceptance. Concurrent requests must converge on one winner; do not allow partial records such as an Operation without its Resource, or a backend change without its replay record.

At minimum, retain enough information to identify and resume the original request after restart:

- Stable principal, API version, Idempotency-Key, and the method, path/query, generation condition, and JSON value needed to match a retry.
- Host-issued Resource UID, Form URL, Space, name, accepted desired `spec`, and current generation.
- Operation ID, action, generation, status/effect, acceptance time, and retention deadline.
- Execution state bound to that Operation and the backend identity needed to verify its outcome.

The key scope is `(Host, API version, stable principal, key)`. The same key and request return the original Operation; reusing the key for a different request is rejected as a conflict. Do not discard unfinished Operations or unknown effects at an ordinary retention deadline. The common contract does not choose a database, queue, ORM, or encryption scheme. It requires durability and concurrency control that preserve these associations.

## Bind execution to the original Operation {#dispatch}

The HTTP handler and backend work may have different lifetimes. If work continues in a separate worker, provide a durable notification or equivalent recovery path that can resume accepted Operations. Duplicate delivery and restart must continue the original Operation—not create a new UID, Operation, or backend object. While an effect is unresolved, reject another mutation on that UID as `resource_busy`.

`GET /operations/{id}` reads current recorded state. It does not resend Create/Update/Delete or start reconciliation merely because a client polled. Background execution advances work independently. Resource GET returns the last verified `observed`, `observedGeneration`, and `observedAt`. An implementation may perform read-only refresh during GET, but it must not start effectful work or label unverified values as observed.

## Recover at each restart or lost-ack point {#recovery}

| Failure point | Durable state and recovery action |
| --- | --- |
| Before acceptance is recorded | No Operation or backend effect was accepted. Revalidate the request; if accepted, create the durable record once. Requests arriving with the same key converge on that record. |
| After acceptance, before dispatch | Restore `queued/effect:none` and the original dispatch data, then advance that Operation. Do not reissue a UID or key. |
| After dispatch, before recording the backend result | Do not assume execution never happened. Set `reconciling/effect:unknown` and check using the saved backend identity. Block a new mutation until the result is established; a timeout alone cannot mean `failed/effect:none`. |
| After backend success, before terminal state is recorded | Reconcile or read back the backend, then advance the original Operation when success is verified. Do not create a second Operation to repeat the successful effect. |

If only the client acknowledgement was lost and the Host's acceptance record remains, replaying the same request with the same key returns the same Operation's current state. If authorization has been revoked, the Host may hide that state with `403` or `404`.

## Keep success separate from observation {#observation}

An Operation reports progress and effect for one Form-defined management action. `succeeded/effect:complete` means that action completed; it is not a general service-health result. Keep the accepted desired value in Resource `spec` and update `observed` only with values verified at the backend. After failure, preserve the Resource and any known partial-effect mapping so the Form's same-UID Update/Delete recovery remains possible.

Once these obligations are met, the choice of worker, database, and queue arrangement belongs to the Host. Follow the [HTTP API contract](/spec/host-api/v2/http) for normative statuses, retention, `404`/`410`, and problem details.

## Check your Host against the baseline {#check}

[Section 10 of the HTTP API](/spec/host-api/v2/http#conformance) lists what a Host must demonstrate through its public API. This repository includes a [baseline probe](https://github.com/tako0614/takoform/tree/main/conformance/v2) that drives one mandatory lifecycle against your Host and stops at the first response that breaks the contract. It is a development check, not a certification: a pass covers the steps it ran, for one Form, through the transport you supply. For each Section 10 obligation:

1. **Exact Form support**
   - Probe checks: `support` for your Form and for a Form URL you do not implement, and that Create with that URL returns `422 unsupported_form`.
   - You demonstrate: the Host never fetches an unsupported URL.
2. **Same UID and generation rules**
   - Probe checks: Create, read, list, update, and delete of one Resource, with generations 1, 2, and 3 on the same UID, then `404` or `410` and removal from the list.
   - You demonstrate: the same rules for your other Forms.
3. **Keys, generations, and principals**
   - Probe checks: same-key replay returns the original Operation; a changed body under that key returns `409 idempotency_conflict`; a stale generation returns `409 generation_conflict` and changes nothing.
   - You demonstrate: concurrent requests with matching keys, and isolation between principals.
4. **Response loss and process restart**
   - Probe checks: nothing.
   - You demonstrate: the restart experiment at each point in [Recover at each restart or lost-ack point](#recovery).
5. **Partial failure**
   - Probe checks: nothing.
   - You demonstrate: with fault injection, that partial effects stay visible and recoverable on the same UID.
6. **Optional features**
   - Probe checks: when advertised, that your selected Offering is listed and kept; with private inputs, that Discovery and `support` both declare them.
   - You demonstrate: each advertised feature's refusal, retry, and secret non-disclosure rules.

Along the way it also checks the Discovery, Operation, and Resource shapes, `Location` and `Retry-After`, response media types, and that each finished Operation's `retainUntil` is at least the advertised replay window after its last update.

### Run the probe {#run-check}

The probe is a JavaScript module without a CLI or dependencies; it has been run with Node.js 22 and 26. It never looks up credentials: you pass a `transport` function that performs each request and adds your Host's authentication. It accepts only an HTTPS origin, so put a local Host behind TLS before checking it.

Choose a Space you can safely write to, because the probe creates, updates, and deletes a real Resource. The fixture's `form` must support create, read, update, and delete on your Host; `unknownForm` must be a URL it does not implement.

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

If your Form needs private inputs, add `privateInputs` (a map of strings) to the fixture; the probe sends them only when Discovery and `support` both declare the capability. `pollDelayMs`, `maxPolls` (10 by default, up to 100), and `timeoutMs` (per request, 10000 by default) bound the run. Raise them for a Host whose Operations take longer than a few seconds.

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

`fullConformance` is always `false`. Treat `gaps` as the remaining Section 10 work: the restart experiment, fault injection, concurrent and cross-principal requests, every optional feature you advertise, and each Form's own behavior. To check a Form's results as well, add `expectedSpec` or an `assertResource(resource)` function that returns `true` to the fixture.
