---
title: Implementing a v2 client
description: Design client recovery around durable intent records, replay deadlines, Operations, generations, and authorization changes.
---

# Implementing a v2 client {#client}

This guide is for building a v2 client; the Go Host client in this repository speaks v1. Read a v2 Host's [Discovery](/glossary#discovery) response for `baseUrl`, authentication guidance, and `replayWindowSeconds` (the [replay window](/glossary#replay-window)); build each request from the Form specification at its exact URL. Check `support`, Space authorization, and operation outcome as separate facts.

## Record intent before sending {#intent}

To identify the same operation across a client restart or a lost acknowledgement, persist one intent record before transmitting. Keep at least:

- Host origin and API version, Form URL, Space, and Resource name or UID.
- Method, API-root-relative path and query, and the complete request (including the generation condition and complete `spec` for Update).
- An Idempotency-Key created for this intent and its initial send time.
- The replay window read from Discovery. Do not reset the initial time on each retry.
- After a response, the Operation ID, Resource UID, accepted generation, `Location`, and `retainUntil`.

Do not copy authentication credentials into the intent log; use the client's authentication manager. If a Form uses private inputs, do not write those values to ordinary logs or public state; follow the HTTP contract's secret handling.

An Idempotency-Key is not reusable merely because a request body happens to match. It identifies one user intent while that request is being retried. A new desired value or distinct change uses a new key, even on the same Resource.

## Decide from the outcome {#decisions}

| Outcome | Client action |
| --- | --- |
| `202 Accepted` | Wait `Retry-After`, then GET the `Location` or Operation ID. Follow that Operation to a terminal state and reread the Resource. Do not create another mutation. |
| Lost response, still within replay window | If the same stable principal remains authorized, resend the stored method, path/query, body, and key unchanged. Do not alter the body or create a new key. The Host returns the original Operation's current state; it may be `202` while work is unfinished or `200` once settled. |
| Operation is `reconciling` / `effect: unknown` | Retain the UID and Operation ID as unresolved and continue checking the Operation. Do not send another mutation to that UID until the Host resolves the original backend identity. GET is not a substitute for recovery work. |
| `409 generation_conflict` | The request was not accepted and has no Operation. GET the current Resource and decide what change is still intended. If continuing, create a new intent with the current generation and a new key. |
| Replay window near or past its deadline | Stop automatic replay before `initial send time + replayWindowSeconds`. Check any known Operation ID and reconcile Resource/list evidence. If acceptance remains unknown, do not blindly resend with either the old or a new key. |

Keep Resource `generation`, `observedGeneration`, and `observedAt` distinct from Operation state. Operation success means the Form-defined management action completed; it is not a general application-health guarantee.

## Follow one change in code {#loop}

These two functions apply the table above to one recorded intent. They are a reference for your own client, not a library: `applyChange` sends the request and replays it only inside the replay window, and `followOperation` follows the accepted Operation to its end and reads the Resource. After a restart, call `followOperation` with the saved Operation ID instead of sending the change again.

```js
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const isProblem = (response) => response.headers
  .get("content-type")?.startsWith("application/problem+json");
// Retry-After is seconds or an HTTP date; else use the default.
const delay = (response, seconds) => {
  const value = response?.headers.get("retry-after") ?? "";
  const ms = /^\d+$/u.test(value)
    ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return ms > 0 ? ms : seconds * 1000;
};

// Send one recorded intent and follow it to its result.
// `http(method, path, headers, body)` sends one request to the API
// root with your Host's authentication; `save` stores the intent
// durably. The intent holds method, path, headers, body, key,
// firstSentAt, and replayWindowMs.
async function applyChange(http, save, intent) {
  await save(intent);
  const deadline = intent.firstSentAt + intent.replayWindowMs;
  if (Date.now() >= deadline) return { result: "unknown", intent };
  let response;
  let value;
  let uncertain = false;
  for (let attempt = 0; ; attempt++) {
    response = undefined;
    value = undefined;
    try {
      response = await http(intent.method, intent.path,
        { ...intent.headers, "Idempotency-Key": intent.key },
        intent.body);
      const api = response.ok
        || (response.status < 500 && isProblem(response));
      if (api) value = await response.json();
    } catch {
      // Lost or unreadable: the Host may have accepted the change.
    }
    if (value !== undefined && response.status !== 429) break;
    // Lost, 429, 5xx, or a non-API answer: resend the same request
    // with the same key, only before the window ends.
    uncertain ||= response?.status !== 429;
    const wait = delay(response, 2 ** attempt);
    if (Date.now() + wait >= deadline) {
      return { result: "unknown", intent };
    }
    await sleep(wait);
  }
  if (!response.ok) {
    if (value.code === "private_inputs_unverifiable") {
      // An earlier send of this change was accepted; follow it
      // when the Host names it, otherwise reconcile.
      if (!value.operationId) return { result: "unknown", intent };
      await save({ ...intent, operationId: value.operationId });
      return followOperation(http, value.operationId);
    }
    const denied = [401, 403, 404, 410].includes(response.status);
    if (uncertain && denied) {
      // Access changed after an uncertain send: keep the intent.
      return { result: "unknown", intent };
    }
    // Not accepted. A 409 code such as generation_conflict says
    // what to read before you decide on a new intent.
    const conflict = response.status === 409;
    const result = conflict ? "conflict" : "rejected";
    return { result, problem: value };
  }
  await save({ ...intent, operationId: value.id,
    resourceUid: value.resourceUid,
    generation: value.generation,
    retainUntil: value.retainUntil,
    location: response.headers.get("location") });
  return followOperation(http, value.id, value, response);
}

// Follow a saved Operation to its end; also use it after a restart.
async function followOperation(http, id, operation, response,
  until = Date.now() + 10 * 60_000) {
  while (!["succeeded", "failed"].includes(operation?.status)) {
    if (operation?.status === "waiting_input") {
      // Replenish the private inputs of this same Operation.
      return { result: "waiting_input", operation };
    }
    const left = until - Date.now();
    if (left <= 0) return { result: "pending", id };
    await sleep(Math.min(delay(response, 1), left));
    try {
      response = await http("GET", `/operations/${id}`);
      if ([401, 403, 404, 410].includes(response.status)) {
        return { result: "unknown", id }; // Reconcile instead.
      }
      if (response.ok) operation = await response.json();
    } catch {
      // A lost or unreadable read is safe to repeat.
    }
  }
  const uid = operation.resourceUid;
  const read = await http("GET", `/resources/${uid}`)
    .then((answer) => (answer.ok ? answer.json() : null))
    .catch(() => null);
  return { result: operation.status, operation, resource: read };
}
```

- `save` runs before the first send and again with the Operation ID, Resource UID, accepted generation, `retainUntil`, and `Location`: the records listed in [Record intent before sending](#intent).
- A request that throws, a `5xx`, or an answer that is not the API's JSON leaves acceptance uncertain, so the same request is resent with the same key; a `429` is resent after its `Retry-After`, given in seconds or as a date. Every resend stops before `firstSentAt + replayWindowMs`; after that the result is `unknown`, so you reconcile instead of starting a new intent.
- `private_inputs_unverifiable` means an earlier send of this change was accepted: the loop saves and follows the Operation the Problem names, or returns `unknown` when it names none. `401`, `403`, `404`, or `410` after an uncertain send proves nothing either way and also returns `unknown`, as [When authentication changes](#auth-change) explains.
- Any other `409` was not accepted, even when its Problem names another Operation, as `resource_busy` does. For `generation_conflict`, read the Resource and, if you still want the change, record a new intent with the current generation and a new key.
- `followOperation` honors `Retry-After` without sleeping past its bound, repeats lost or unreadable reads, returns `waiting_input` so you can replenish private inputs on the same Operation, returns `unknown` when the Operation can no longer be read, and returns `pending` with the ID after ten minutes so you can resume later. A `failed` result still returns the Resource, so you can see `phase: error`.

Supply `http` from the Host's Discovery response and authentication, and record each intent before calling `applyChange`. This example assumes a Host that declares Bearer authentication and no Offerings; add `offering` to the body when the Host advertises them.

```js
const http = (method, path, headers = {}, body) =>
  fetch(`${discovery.baseUrl}${path}`, {
    method,
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

const result = await applyChange(http, save, {
  method: "POST",
  path: "/resources",
  headers: { "Content-Type": "application/json" },
  body: {
    form: "https://forms.publisher.example/key-value-entry/1.0.0",
    space: "default",
    name: "greeting",
    spec: { key: "greeting", value: "hello" },
  },
  key: crypto.randomUUID(),
  firstSentAt: Date.now(),
  replayWindowMs: discovery.limits.replayWindowSeconds * 1000,
});
```

Update and delete name the Resource by UID and carry the generation you read. Build each one from a Resource you have just read: the `resource` of a `succeeded` or `failed` result, or a fresh `GET /resources/{uid}`; after any other result, follow the outcome table first. Each is a new change with its own key, and update sends the complete `spec`, because it replaces the whole document rather than patching it. After a restart, resend the intent you saved instead of building it again, which would create a new key.

```js
const change = (resource, method, body) => {
  if (!resource) throw new Error("Read the Resource first.");
  return {
    method,
    path: `/resources/${resource.uid}`,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      "Takoform-Expected-Generation": String(resource.generation),
    },
    body,
    key: crypto.randomUUID(),
    firstSentAt: Date.now(),
    replayWindowMs: discovery.limits.replayWindowSeconds * 1000,
  };
};

const updated = await applyChange(http, save,
  change(result.resource, "PUT",
    { spec: { key: "greeting", value: "welcome" } }));
const deleted = await applyChange(http, save,
  change(updated.resource, "DELETE"));
```

## When authentication changes {#auth-change}

The Host authenticates and authorizes each request. Follow its authentication documentation to learn whether credential rotation preserves the same stable principal and permissions. A different principal has a different Idempotency-Key scope; do not use a new principal's key to “retry” a request accepted under the old one.

If access was revoked, the Host may return `403` or `404` without revealing an existing Operation. Keep an uncertain intent rather than discarding or recreating it under another key. Restore authorized access to the original principal or agree on reconciliation with the user or Host operator.

## Return to the HTTP contract {#http-contract}

See the [HTTP retry contract](/spec/host-api/v2/http#retry) for matching and retention, and [Update](/spec/host-api/v2/http#update) plus [errors](/spec/host-api/v2/http#errors) for generation conflicts. The [illustrative examples](/spec/host-api/v2/examples) contain complete request/response values.
