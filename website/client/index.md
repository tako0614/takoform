---
title: Implementing a v2 client
description: Design client recovery around durable intent records, replay deadlines, Operations, generations, and authorization changes.
prev:
  text: Getting started
  link: /start/
next:
  text: HTTP API
  link: /spec/host-api/v2/http
---

# Implementing a v2 client {#client}

This guide is for building a v2 client; the Takoform Go client, [`hostclient`](https://pkg.go.dev/github.com/tako0614/takoform/hostclient), speaks v1. Read a v2 Host's [Discovery](/glossary#discovery) response for `baseUrl`, authentication guidance, and `replayWindowSeconds` (the [replay window](/glossary#replay-window)); build each request from the Form specification at its exact URL. Check `support`, whether a request is admissible, and each operation's outcome as separate facts. Whether you may change a Space is settled per change, by the Host's answer to that change, acceptance or a `401` or `403`: a [preview](/spec/host-api/v2/http#previews), where advertised, is only advice, and Resource and Offering lists show only what you may see, so an empty one proves nothing.

## Record intent before sending {#intent}

To identify the same operation across a client restart or a lost acknowledgement, persist one intent record before transmitting. Keep at least:

- Host origin and API version, Form URL, Space, and Resource name or UID.
- Method, API-root-relative path and query, and the complete request (including the generation condition and complete `spec` for Update).
- An Idempotency-Key created for this intent and its initial send time.
- The replay window read from Discovery. Do not reset the initial time on each retry.
- After a response, the Operation ID, Resource UID, accepted generation, `Location`, and `retainUntil`, or the refusal's code; after following the Operation, its result.

Do not copy authentication credentials into the intent log; use the client's authentication manager. If a Form uses private inputs, do not write those values to ordinary logs or public state; follow the HTTP contract's secret handling.

An Idempotency-Key is not reusable merely because a request body happens to match. It identifies one user intent while that request is being retried. A new desired value or distinct change uses a new key, even on the same Resource.

## Decide from the outcome {#decisions}

| Outcome | Client action |
| --- | --- |
| `202 Accepted` | Wait `Retry-After`, then GET `{baseUrl}/operations/{id}` with the body's `id`. `Location` names the same URL; if it ever differs, send no credentials to it. Follow that Operation to a terminal state and reread the Resource. Do not create another mutation. |
| Lost response, still within replay window | If the same stable [principal](/glossary#principal) remains authorized, resend the stored method, path/query, body, and key unchanged. Do not alter the body or create a new key. The Host returns the original Operation's current state; it may be `202` while work is unfinished or `200` once settled. |
| Operation is `reconciling` / `effect: unknown` | Retain the UID and Operation ID as unresolved and continue checking the Operation. Do not send another mutation to that UID until the Host resolves the original backend identity. GET is not a substitute for recovery work. |
| `409 generation_conflict` | The request was not accepted and has no Operation. GET the current Resource and decide what change is still intended. If continuing, create a new intent with the current generation and a new key. |
| Replay window near or past its deadline | Stop automatic replay before `initial send time + replayWindowSeconds`, then follow [When the outcome stays unknown](#unknown). |

Keep Resource `generation`, `observedGeneration`, and `observedAt` distinct from Operation state. Operation success means the Form-defined management action completed; it is not a general application-health guarantee.

### When the outcome stays unknown {#unknown}

Once automatic replay has stopped without an answer, or an Operation can no longer be read, gather evidence before doing anything else:

1. GET any Operation ID you know.
2. GET the Resource by the UID in your intent. If it is a create with no UID yet, [list](/spec/host-api/v2/http#list-resources) its Space and name instead, with `GET /resources?space=…&name=…`.

A Resource with that name may be another client's, and an empty list does not prove that nothing happened. If acceptance or the outcome remains unknown, keep the intent unresolved, do not resend with either the old or a new key, and agree on reconciliation with the user or Host operator.

## Follow one change in code {#loop}

These two functions apply the table above to one recorded intent. They are a reference for your own client, not a library: `applyChange` sends the request and replays it only inside the replay window, and `followOperation` follows the accepted Operation to its end and reads the Resource. `applyChange` records each answer and the Operation's result, so after a restart you [resume an intent](#resume) instead of building it again.

```js
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const isProblem = (response) => response.headers
  .get("content-type")?.startsWith("application/problem+json");
// Retry-After is whole seconds, as on every 202, or an HTTP
// date, which a 429 may send. Otherwise use the default.
const delay = (response, seconds) => {
  const value = response?.headers.get("retry-after") ?? "";
  const ms = /^\d+$/u.test(value)
    ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return ms > 0 ? ms : seconds * 1000;
};

// Send one recorded intent and follow it to its result.
// `http(method, path, headers, body)` sends one request to the API
// root with your Host's authentication; `save` stores the intent
// durably. The intent holds baseUrl (the Host's v2 API root),
// method, path, headers, body, key, firstSentAt, replayWindowMs,
// and, once saved here, attempted. Rather than wait past `until`
// for an answer it can act on, it returns pending; resume it later.
async function applyChange(http, save, intent,
  until = Date.now() + 10 * 60_000) {
  // A saved intent may already have reached the Host.
  let uncertain = intent.attempted === true;
  intent = { ...intent, attempted: true };
  await save(intent);
  const deadline = intent.firstSentAt + intent.replayWindowMs;
  if (Date.now() >= deadline) return { result: "unknown", intent };
  let response;
  let value;
  for (let attempt = 0; ; attempt++) {
    response = undefined;
    value = undefined;
    try {
      response = await http(intent.method, intent.path,
        { ...intent.headers, "Idempotency-Key": intent.key },
        intent.body);
      const api = response.ok || (response.status >= 400
        && response.status < 500 && isProblem(response));
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
    if (Date.now() + wait >= until) {
      return { result: "pending", intent }; // Resume it later.
    }
    await sleep(wait);
  }
  if (!response.ok) {
    if (value.code === "private_inputs_unverifiable") {
      // An earlier send of this change was accepted; follow it
      // when the Host names it, otherwise reconcile.
      if (!value.operationId) return { result: "unknown", intent };
      const named = { ...intent, operationId: value.operationId };
      await save(named);
      const outcome = await followOperation(http,
        named.operationId, undefined, undefined, until);
      await save({ ...named, status: outcome.result });
      return outcome;
    }
    const denied = [401, 403, 404, 410].includes(response.status);
    if (uncertain && denied) {
      // Access changed after an uncertain send: keep the intent.
      return { result: "unknown", intent };
    }
    // Not accepted. A 409 code such as generation_conflict says
    // what to read before you decide on a new intent.
    const refused = value.code ?? response.status;
    await save({ ...intent, refused });
    const conflict = response.status === 409;
    const result = conflict ? "conflict" : "rejected";
    return { result, problem: value };
  }
  const accepted = { ...intent, operationId: value.id,
    resourceUid: value.resourceUid,
    generation: value.generation,
    retainUntil: value.retainUntil,
    location: response.headers.get("location") };
  await save(accepted);
  const outcome = await followOperation(http, value.id, value,
    response, until);
  await save({ ...accepted, status: outcome.result });
  return outcome;
}

// Follow a saved Operation to its end; after a restart, use it for
// a saved Operation and record the result it returns.
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
      // Refused, gone, or redirected: reconcile instead.
      const status = response.status;
      const unreadable = [401, 403, 404, 410].includes(status)
        || (!response.ok && status < 400);
      if (unreadable) return { result: "unknown", id };
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

- `save` runs before the first send, again with the Operation ID, Resource UID, accepted generation, `retainUntil`, and `Location`, and once more with the refusal's code or the Operation's result: the records listed in [Record intent before sending](#intent).
- A request that throws, a `5xx`, a redirect, or an answer that is not the API's JSON leaves acceptance uncertain, so the same request is resent with the same key; a `429` is resent after its `Retry-After`, given in seconds or as a date. Every resend stops before `firstSentAt + replayWindowMs`; after that the result is `unknown`, so you [gather evidence](#unknown) instead of starting a new intent. A replay window can last a day, so rather than wait past ten minutes for an answer it can act on, `applyChange` returns `pending`, and you [resume](#resume) the intent later.
- `private_inputs_unverifiable`, which a Host answers when it has lost the material to compare a replay's [private inputs](/spec/host-api/v2/http#private-inputs) (a Host retention failure), means an earlier send of this change was accepted: the loop saves and follows the Operation the Problem names, or returns `unknown` when it names none. `401`, `403`, `404`, or `410` after an uncertain send proves nothing either way and also returns `unknown`, as [When authentication changes](#auth-change) explains.
- Any other `409` was not accepted, even when its Problem names another Operation, as a `resource_busy` Problem may. For `generation_conflict`, read the Resource and, if you still want the change, record a new intent with the current generation and a new key. For `resource_busy`, another change was unfinished when the Host answered, so yours was not accepted. Wait for that change to end: poll the Operation the Problem names, or reread the Resource until its `phase` is `idle` or `error`. That Operation is not this intent; if it is one of your saved intents, resume that one. Otherwise you cannot replenish its private inputs, and a `403`, `404`, `410`, or redirect while reading it does not make this change unknown: reread the Resource instead. Then decide as for `generation_conflict`.
- `followOperation` honors `Retry-After` without sleeping past its bound, repeats lost or unreadable reads, returns `waiting_input` so you can replenish private inputs on the same Operation, returns `unknown` when the Operation can no longer be read (see [When the outcome stays unknown](#unknown) and [When authentication changes](#auth-change)), and returns `pending` with the ID after ten minutes, or once `applyChange`'s own bound is reached, so you can resume later. A `failed` result still returns the Resource, so you can see `phase: error`.

Read the Host's [Discovery](/spec/host-api/v2/http#discovery) first, without credentials, and stop if it is invalid instead of repairing it: requests built from a repaired `baseUrl` would carry your credentials to an address the Host never advertised. Then build `http` from its `baseUrl` and your authentication, and record each intent before calling `applyChange`. This example assumes a Host that declares Bearer authentication and no Offerings; add `offering` to the body when the Host advertises them.

```js
async function readDiscovery(input) {
  // Accept only an HTTPS origin, however it is typed:
  // "https://Host.example/" means "https://host.example".
  const typed = new URL(input);
  const origin = typed.origin;
  if (typed.protocol !== "https:" || typed.href !== `${origin}/`) {
    // Name no typed credentials in the error.
    const shown = typed.username || typed.password
      ? "a URL with credentials" : typed.href;
    throw new Error(`Not an HTTPS origin: ${shown}; stop.`);
  }
  // Discovery needs no credentials and answers 200, not a redirect.
  const url = `${origin}/.well-known/takoform/v2`;
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const found = response.status === 200
    ? await response.json().catch(() => undefined) : undefined;
  const isHttps = (value) => typeof value === "string"
    && URL.canParse(value) && new URL(value).protocol === "https:";
  const base = isHttps(found?.baseUrl)
    ? new URL(found.baseUrl) : undefined;
  const schemes = found?.authentication?.schemes;
  const valid = [
    found?.api === "forms.takoform.com/v2",
    // HTTPS on this origin, exactly as the URL serializes it (an
    // origin root gains a "/"), without userinfo, query, fragment,
    // or trailing slash.
    base?.origin === origin && !base.username && !base.password
      && [found.baseUrl, `${found.baseUrl}/`].includes(base.href)
      && !/[?#]|\/$/u.test(found.baseUrl),
    isHttps(found?.documentation)
      && isHttps(found?.authentication?.documentation),
    Array.isArray(schemes) && schemes.length > 0
      && schemes.every((name) => typeof name === "string" && name),
    ["offerings", "previews", "privateInputs"].every((name) =>
      typeof found?.capabilities?.[name] === "boolean"),
    ["maxRequestBytes", "maxPageSize", "replayWindowSeconds"]
      .every((name) => Number.isSafeInteger(found?.limits?.[name])
        && found.limits[name] > 0),
  ].every(Boolean);
  if (!valid) {
    throw new Error(`Invalid Discovery at ${origin}; stop.`);
  }
  return found;
}

const discovery = await readDiscovery("https://host.example");

// Never follow a redirect: it would resend credentials on the same
// origin, and a change's body and key even to another one.
const http = (method, path, headers = {}, body) =>
  fetch(`${discovery.baseUrl}${path}`, {
    method,
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
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
  baseUrl: discovery.baseUrl,
  firstSentAt: Date.now(),
  replayWindowMs: discovery.limits.replayWindowSeconds * 1000,
});
```

Update and delete name the Resource by UID and carry the generation you read. Build each one from a Resource you have just read whose `phase` is `idle` or `error`, whether it is the `resource` of a `succeeded` or `failed` result or a fresh `GET /resources/{uid}`. While it is `pending` or `deleting`, another change is unfinished: a new one would be refused with `409 resource_busy` while that lasts, or would act on a state you have not seen if it ended first, so wait for it and read again. A read is a snapshot, so a change can still meet `resource_busy` or `generation_conflict`; handle them as above. Each is a new change with its own key, and update sends the complete `spec`, because it replaces the whole document rather than patching it.

<a id="resume"></a>

After a restart or a `pending` result, resume only intents without a final answer instead of building them again, which would create a new key. Send each through the Host it was recorded for: read Discovery again from the origin of its `baseUrl` and build `http` from the `baseUrl` advertised now. A `pending` result with an `intent` resumes with `applyChange`, and one with an `id` with `followOperation`. A resumed intent may already have reached the Host, so a `401`, `403`, `404`, or `410` leaves it unresolved rather than refused. Follow a saved Operation that has no recorded `succeeded` or `failed` result with `followOperation`, and record the result it returns; resend an intent that has neither an Operation nor a recorded refusal with `applyChange`, which still stops at the replay window and then returns `unknown`. Never resend an intent the Host refused. An intent is finished once the Host has refused it or you have recorded its Operation as `succeeded` or `failed`. An unfinished Operation stays readable until it ends; a finished one stays readable at least until its current `retainUntil`, which the Host extends when it ends.

```js
const change = (resource, method, body) => {
  if (!resource) throw new Error("Read the Resource first.");
  if (!["idle", "error"].includes(resource.phase)) {
    throw new Error("Wait for its unfinished change first.");
  }
  return {
    method,
    path: `/resources/${resource.uid}`,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      "Takoform-Expected-Generation": String(resource.generation),
    },
    body,
    key: crypto.randomUUID(),
    baseUrl: discovery.baseUrl,
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
