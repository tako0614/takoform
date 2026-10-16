import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { runHostApiV2 } from "./host-api.mjs";

const form = "https://forms.example.test/fixture/0.1.0";
const unknownForm = "https://forms.example.test/unknown/0.1.0";
const root = "https://host.example.test/custom/api";
const fixture = {
  disposable: true,
  form,
  unknownForm,
  space: "test-space",
  name: "lifecycle-1",
  spec: { value: "sample" },
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json", ...headers },
  });
}

function problem(status, code) {
  return json({ type: "about:blank", title: code, status, code }, status);
}

function makeHost(defect) {
  const resources = new Map();
  const operations = new Map();
  const keys = new Map();
  let next = 1;
  const operation = (action, resource) => {
    const id = `op-${next++}`;
    const op = {
      id, resourceUid: resource.uid, action, generation: resource.generation,
      status: "succeeded", effect: "complete", createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:00:00Z", retainUntil: "2026-10-07T00:00:00Z",
    };
    operations.set(id, op);
    resource.lastOperation = id;
    return op;
  };
  return async ({ method, url, headers = {}, body }) => {
    const u = new URL(url);
    if (u.pathname === "/.well-known/takoform/v2") return json({
      api: "forms.takoform.com/v2", baseUrl: root,
      documentation: "https://host.example.test/docs?section=v2#overview",
      authentication: { schemes: ["None"], documentation: "https://host.example.test/auth#none" },
      capabilities: { offerings: defect === "paged-offering", previews: false, privateInputs: false },
      limits: { maxRequestBytes: 10000, maxPageSize: 100, replayWindowSeconds: 3600 },
    });
    if (!url.startsWith(`${root}/`)) return problem(404, "not_found");
    const path = url.slice(root.length).split("?")[0];
    if (method === "GET" && path === "/support") {
      const supported = u.searchParams.get("form") === form;
      return json({ form: u.searchParams.get("form"), supported,
        operations: supported ? ["create", "read", "update", "delete"] : [], privateInputs: false });
    }
    if (method === "GET" && path === "/offerings" && defect === "paged-offering") {
      return u.searchParams.get("cursor") === "next"
        ? json({ items: [{ id: "selected", revision: "r1", form }], nextCursor: null })
        : json({ items: [{ id: "other", revision: "r1", form }], nextCursor: "next" });
    }
    if (method === "GET" && path === "/resources") {
      return json({ items: [...resources.values()].filter((r) => (defect === "retained-deleted-list" ||
        (r.space === u.searchParams.get("space") && r.name === u.searchParams.get("name") && r.form === u.searchParams.get("form")))), nextCursor: null });
    }
    if (method === "GET" && path.startsWith("/resources/")) {
      const resource = resources.get(path.slice(11));
      return resource ? json(resource) : problem(404, "not_found");
    }
    if (method === "GET" && path.startsWith("/operations/")) {
      const op = operations.get(path.slice(12));
      return op ? json(defect === "wrong-operation-read" ? { ...op, resourceUid: "wrong" } : op) : problem(404, "not_found");
    }
    if (["POST", "PUT", "DELETE"].includes(method)) {
      const key = headers["Idempotency-Key"];
      const signature = JSON.stringify([method, path, headers["Takoform-Expected-Generation"], body]);
      if (keys.has(key)) {
        const old = keys.get(key);
        if (old.signature !== signature) return problem(409, "idempotency_conflict");
        const op = operations.get(old.id);
        return json(defect === "replay-new-operation" ? { ...op, id: "op-rogue" } : op, 200,
          { Location: `${root}/operations/${defect === "replay-new-operation" ? "op-rogue" : op.id}` });
      }
      if (method === "POST" && path === "/resources") {
        if (body.form !== form) return problem(422, "unsupported_form");
        const resource = { uid: "resource-1", form: body.form, space: body.space, name: body.name,
          ...(body.offering && { offering: body.offering }),
          generation: 1, observedGeneration: 1, observedAt: "2026-10-06T00:00:00Z",
          phase: "idle", spec: defect === "normalized-spec" ? { ...body.spec, defaulted: true } : body.spec,
          observed: {}, output: {}, lastOperation: "" };
        resources.set(resource.uid, resource);
        const op = operation("create", resource);
        keys.set(key, { signature, id: op.id });
        return json(defect === "missing-resource-uid" ? { ...op, resourceUid: undefined } : op,
          defect === "terminal-as-202" ? 202 : 200,
          { Location: `${root}/operations/${op.id}`, ...(defect === "terminal-as-202" && { "Retry-After": "1" }) });
      }
      const resource = resources.get(path.slice(11));
      if (!resource) return problem(404, "not_found");
      if (Number(headers["Takoform-Expected-Generation"]) !== resource.generation) {
        return defect === "accept-stale-generation" ? json(operation("update", resource), 200,
          { Location: `${root}/operations/${resource.lastOperation}` }) : problem(409, "generation_conflict");
      }
      resource.generation++;
      if (method === "PUT") resource.spec = body.spec;
      const op = operation(method === "PUT" ? "update" : "delete", resource);
      keys.set(key, { signature, id: op.id });
      if (method === "DELETE") resources.delete(resource.uid);
      return json(op, 200, { Location: `${root}/operations/${op.id}` });
    }
    return problem(404, "not_found");
  };
}

test("executes the mandatory HTTP lifecycle but does not certify restart or optional behavior", async () => {
  const result = await runHostApiV2({ origin: "https://host.example.test", transport: makeHost(), fixture });
  expect(result.baseline).toBe("passed");
  expect(result.gaps.restart).toBe("not-tested");
  expect(result.gaps.faultInjection).toBe("not-tested");
  expect(result.fullConformance).toBe(false);
});

test("finds a caller-selected Offering on a later page", async () => {
  const selected = { ...fixture, offering: { id: "selected", revision: "r1" } };
  const result = await runHostApiV2({ origin: "https://host.example.test", transport: makeHost("paged-offering"), fixture: selected });
  expect(result.baseline).toBe("passed");
});

test("leaves Form-specific spec normalization to a caller assertion", async () => {
  const transport = makeHost("normalized-spec");
  const result = await runHostApiV2({ origin: "https://host.example.test", transport, fixture });
  expect(result.baseline).toBe("passed");
  expect(runHostApiV2({ origin: "https://host.example.test", transport: makeHost("normalized-spec"),
    fixture: { ...fixture, expectedSpec: fixture.spec } })).rejects.toThrow();
});

test.each(["replay-new-operation", "accept-stale-generation", "wrong-operation-read", "terminal-as-202"])("rejects broken Host: %s", async (defect) => {
  expect(runHostApiV2({ origin: "https://host.example.test", transport: makeHost(defect), fixture })).rejects.toThrow();
});

test("rejects a missing create resourceUid at the accepting response", async () => {
  expect(runHostApiV2({ origin: "https://host.example.test", transport: makeHost("missing-resource-uid"), fixture }))
    .rejects.toThrow("v2 HTTP baseline create:");
});

test("rejects a response whose JSON body never finishes", async () => {
  const transport = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
  }), { headers: { "content-type": "application/json" } });
  expect(runHostApiV2({ origin: "https://host.example.test", transport, fixture, timeoutMs: 20 })).rejects.toThrow();
});

test("does not expose a transport exception containing a private value", async () => {
  const marker = "private-value-must-not-appear";
  const transport = async () => { throw new Error(marker); };
  try {
    await runHostApiV2({ origin: "https://host.example.test", transport, fixture });
    throw new Error("expected rejection");
  } catch (error) {
    expect(error.message).not.toContain(marker);
  }
});

test("refuses absent or non-disposable fixture without sending a request", async () => {
  let sent = 0;
  const transport = async () => { sent++; return problem(500, "internal_error"); };
  expect(runHostApiV2({ origin: "https://host.example.test", transport })).rejects.toThrow();
  expect(runHostApiV2({ origin: "https://host.example.test", transport, fixture: { ...fixture, disposable: false } })).rejects.toThrow();
  expect(sent).toBe(0);
});

test.each([
  `${root}?`, `${root}#`, "https://@host.example.test/custom/api",
  "https://:@host.example.test/custom/api", "https://host.example.test/custom\\api",
  "https://host.example.test/custom/api\n",
])("rejects lexically invalid discovery baseUrl %s", async (baseUrl) => {
  const host = makeHost();
  const transport = async (request) => {
    const response = await host(request);
    if (!request.url.endsWith("/.well-known/takoform/v2")) return response;
    return json({ ...(await response.json()), baseUrl });
  };
  expect(runHostApiV2({ origin: "https://host.example.test", transport, fixture }))
    .rejects.toThrow("v2 HTTP baseline discovery");
});

test.each([
  `${form}?`, `${form}#`, "https://@forms.example.test/fixture/0.1.0",
  "https://forms.example.test/fixture\\0.1.0", "https://forms.example.test/fixture/0.1.0\n",
])("rejects lexically invalid Form URL before transport %s", async (invalidForm) => {
  let sent = 0;
  const transport = async () => { sent++; return problem(500, "internal_error"); };
  expect(runHostApiV2({ origin: "https://host.example.test", transport,
    fixture: { ...fixture, form: invalidForm } })).rejects.toThrow("v2 HTTP baseline fixture.form");
  expect(sent).toBe(0);
});


test("the Host guide's runnable example passes against a conforming Host", async () => {
  const guide = readFileSync(new URL("../../website/host-api/index.md", import.meta.url), "utf8");
  const code = guide.slice(guide.indexOf("{#run-check}")).match(/```js\n([\s\S]*?)```/u)?.[1];
  expect(code).toStartWith('import { runHostApiV2 } from "./conformance/v2/host-api.mjs";\n');
  const script = code.replace(/^import .*\n/u, "")
    .replace('"https://host.example"', JSON.stringify(new URL(root).origin))
    .replace('"https://forms.publisher.example/key-value-entry/1.0.0"', JSON.stringify(form))
    .replace('"https://forms.publisher.example/unknown/1.0.0"', JSON.stringify(unknownForm))
    .replace("pollDelayMs: 1000", "pollDelayMs: 0");
  const host = makeHost();
  const sent = [];
  const fetch = (url, init) => {
    sent.push(init.headers);
    return host({ method: init.method, url, headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body) });
  };
  const logged = [];
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction("runHostApiV2", "fetch", "process", "console", script)(
    runHostApiV2, fetch, { env: { HOST_TOKEN: "guide-token" } }, { log: (value) => logged.push(value) });
  expect(logged).toEqual([{
    baseline: "passed", fullConformance: false,
    gaps: { restart: "not-tested", faultInjection: "not-tested", concurrentRequests: "not-tested",
      crossPrincipal: "not-tested", optionalFeatures: "not-tested", formSpecific: "not-tested" },
  }]);
  expect(sent[0].Authorization).toBeUndefined();
  expect(sent.slice(1).every((headers) => headers.Authorization === "Bearer guide-token")).toBe(true);
  for (const gap of Object.keys(logged[0].gaps)) expect(guide).toContain(`${gap}: 'not-tested'`);
  const failure = guide.match(/`v2 HTTP baseline ([a-z-]+): ([^`]+)`/u);
  expect(readFileSync(new URL("./host-api.mjs", import.meta.url), "utf8"))
    .toContain(`"${failure[1]}", "${failure[2]}"`);
});

test("the client guide's loop follows changes against an asynchronous Host", async () => {
  const guide = readFileSync(new URL("../../website/client/index.md", import.meta.url), "utf8");
  const [loop, usage] = [...guide.slice(guide.indexOf("{#loop}")).matchAll(/```js\n([\s\S]*?)```/gu)]
    .slice(0, 2).map((match) => match[1]);
  const sleepLine = "const sleep = (ms) => new Promise((done) => setTimeout(done, ms));";
  expect(loop).toStartWith(sleepLine);

  // The fake Host settles mutations at once; answer them as an asynchronous Host would.
  const host = makeHost();
  const pending = new Set();
  const asynchronous = async ({ method, url, headers, body }) => {
    const response = await host({ method, url, headers, body });
    const path = url.slice(root.length);
    if (method !== "GET" && response.status === 200) {
      const operation = await response.json();
      pending.add(operation.id);
      return json({ ...operation, status: "running", effect: "unknown" }, 202,
        { Location: response.headers.get("location"), "Retry-After": "2" });
    }
    if (method === "GET" && path.startsWith("/operations/") && pending.delete(path.slice(12))) {
      const operation = await response.json();
      return json({ ...operation, status: "running", effect: "unknown" }, 200, { "Retry-After": "3" });
    }
    return response;
  };
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ method: init.method, url, headers: init.headers, signal: init.signal });
    return asynchronous({ method: init.method, url, headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body) });
  };
  const saved = [];
  const save = async (record) => { saved.push(record); };
  const waits = [];
  const discovery = { baseUrl: root, limits: { replayWindowSeconds: 3600 } };
  // The stub yields like a timer would and turns runaway retrying into a failure.
  const program = loop.replace(sleepLine, `const sleep = async (ms) => {
    waits.push(ms);
    if (waits.length > 200) throw new Error("runaway retries");
    await new Promise((done) => setImmediate(done));
  };`)
    + usage.replace('"https://forms.publisher.example/key-value-entry/1.0.0"', JSON.stringify(form))
    + "\nreturn { applyChange, followOperation, http, result };";
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const { applyChange, followOperation, http, result } = await new AsyncFunction(
    "fetch", "save", "discovery", "token", "crypto", "waits", program)(
    fetch, save, discovery, "guide-token", globalThis.crypto, waits);

  // Accepted with 202, followed through Retry-After to success, then the Resource is read.
  expect(result.result).toBe("succeeded");
  expect(result.resource.generation).toBe(1);
  expect(waits).toEqual([2000, 3000]);
  expect(saved[1]).toMatchObject({ operationId: result.operation.id, resourceUid: result.resource.uid,
    generation: 1, retainUntil: result.operation.retainUntil,
    location: `${root}/operations/${result.operation.id}` });
  expect(sent.every(({ headers, signal }) => headers.Authorization === "Bearer guide-token" && signal)).toBe(true);
  const uid = result.resource.uid;

  const update = (key, value, generation, extra = {}) => ({ method: "PUT", path: `/resources/${uid}`,
    headers: { "Content-Type": "application/json", "Takoform-Expected-Generation": String(generation) },
    body: { spec: { value } }, key, firstSentAt: Date.now(), replayWindowMs: 3_600_000, ...extra });
  const send = (transport, intent) => { waits.length = 0; return applyChange(transport, save, intent); };

  // A response lost after acceptance is replayed with the same key and finds the same Operation.
  let drop = 1;
  const lossy = async (...args) => {
    const response = await http(...args);
    if (args[0] === "PUT" && drop-- > 0) throw new Error("response lost after acceptance");
    return response;
  };
  const first = update("guide-update-000001", "welcome", 1);
  const replayed = await send(lossy, first);
  expect(replayed.result).toBe("succeeded");
  expect(replayed.resource.generation).toBe(2);
  expect((await send(http, first)).operation.id).toBe(replayed.operation.id);

  // A 5xx error page is uncertain: the same request is resent and applied once.
  let failures = 1;
  const flaky = async (...args) => (args[0] === "PUT" && failures-- > 0
    ? new Response("<html>bad gateway</html>", { status: 502 }) : http(...args));
  const afterOutage = await send(flaky, update("guide-update-000002", "after outage", 2));
  expect(afterOutage.result).toBe("succeeded");
  expect(afterOutage.resource.generation).toBe(3);

  // A temporarily unavailable Host answers with a Problem; that is still retried.
  let busy = 1;
  const unavailable = async (...args) => (args[0] === "PUT" && busy-- > 0
    ? problem(503, "temporarily_unavailable") : http(...args));
  expect((await send(unavailable, update("guide-update-000008", "retried", 3))).resource.generation).toBe(4);

  // A first answer that refuses access is a rejection, not an uncertain change.
  const refused = await send(async () => problem(403, "forbidden"), update("guide-update-000009", "x", 4));
  expect(refused).toEqual({ result: "rejected", problem: expect.objectContaining({ code: "forbidden" }) });

  // Not accepted: a stale generation is a conflict without an Operation.
  const stale = await send(http, update("guide-update-000003", "stale", 1));
  expect(stale.result).toBe("conflict");
  expect(stale.problem.code).toBe("generation_conflict");

  // Past the replay window nothing is sent.
  const before = sent.length;
  const expired = await send(http, update("guide-update-000004", "late", 4, { firstSentAt: Date.now() - 3_600_000 }));
  expect(expired.result).toBe("unknown");
  expect(sent.length).toBe(before);

  // Access revoked after an uncertain send keeps the intent unresolved.
  let lost = false;
  const revoked = async () => {
    if (!lost) { lost = true; throw new Error("lost"); }
    return problem(401, "unauthenticated");
  };
  expect((await send(revoked, update("guide-update-000005", "x", 4))).result).toBe("unknown");

  // A Problem naming an accepted Operation is followed instead of being treated as a rejection.
  const named = async (method, path, ...rest) => (method === "PUT"
    ? json({ type: "about:blank", title: "conflict", status: 409, code: "private_inputs_unverifiable",
      operationId: result.operation.id }, 409)
    : http(method, path, ...rest));
  expect((await send(named, update("guide-update-000006", "x", 4))).result).toBe("succeeded");

  // Another unfinished Operation named by resource_busy is not this change.
  const busyOther = async (method, path, ...rest) => (method === "PUT"
    ? json({ type: "about:blank", title: "busy", status: 409, code: "resource_busy", operationId: "op-other" }, 409)
    : http(method, path, ...rest));
  const busyResult = await send(busyOther, update("guide-update-000018", "x", 4));
  expect(busyResult.result).toBe("conflict");
  expect(busyResult.problem.code).toBe("resource_busy");
  expect(saved.some((record) => record.operationId === "op-other")).toBe(false);

  // waiting_input, a vanished Operation, and an unfinished one are returned to the caller.
  const waiting = async (method, path, ...rest) => (method === "PUT"
    ? json({ id: "op-w", resourceUid: uid, status: "waiting_input" }, 202, { Location: `${root}/operations/op-w` })
    : http(method, path, ...rest));
  expect((await send(waiting, update("guide-update-000007", "x", 4))).result).toBe("waiting_input");
  const gone = async (method, path, ...rest) => (path.startsWith("/operations/")
    ? problem(410, "gone") : http(method, path, ...rest));
  expect(await followOperation(gone, "op-old")).toEqual({ result: "unknown", id: "op-old" });
  expect(await followOperation(http, "op-later", { status: "running" }, undefined, Date.now() - 1))
    .toEqual({ result: "pending", id: "op-later" });

  // Rate limiting is not uncertainty: resend after Retry-After (seconds or a date).
  let limited = 2;
  const throttled = async (...args) => {
    if (args[0] !== "PUT" || limited <= 0) return http(...args);
    const retry = limited-- === 2 ? "5" : new Date(Date.now() + 7000).toUTCString();
    return json({ type: "about:blank", title: "slow down", status: 429, code: "rate_limited" }, 429,
      { "Retry-After": retry });
  };
  const throttledResult = await send(throttled, update("guide-update-000010", "throttled", 4));
  expect(throttledResult.resource.generation).toBe(5);
  expect(waits[0]).toBe(5000);
  expect(waits[1]).toBeGreaterThan(4000);
  expect(waits[1]).toBeLessThanOrEqual(7000);
  let once429 = true;
  const thenRefused = async () => {
    if (once429) { once429 = false; return problem(429, "rate_limited"); }
    return problem(403, "forbidden");
  };
  expect((await send(thenRefused, update("guide-update-000011", "x", 5))).result).toBe("rejected");

  // Answers that are not the API's JSON leave acceptance uncertain and are resent.
  for (const [label, page] of [["proxy 400", new Response("<html>", { status: 400 })],
    ["non-JSON 200", new Response("<html>portal</html>", { status: 200 })]]) {
    let odd = 1;
    const strange = async (...args) => (args[0] === "PUT" && odd-- > 0 ? page : http(...args));
    const settled = await send(strange, update(`guide-update-${label.replace(/\W/gu, "")}`, label, 5 + (label === "non-JSON 200")));
    expect(settled.result, label).toBe("succeeded");
  }

  // Unreadable polls are repeated; a lost read or a 5xx does not end the wait.
  let pollFaults = 2;
  const unsteady = async (method, path, ...rest) => {
    if (path.startsWith("/operations/") && pollFaults > 0) {
      if (pollFaults-- === 2) throw new Error("poll lost");
      return new Response("busy", { status: 503 });
    }
    return http(method, path, ...rest);
  };
  expect((await send(unsteady, update("guide-update-000012", "unsteady", 7))).result).toBe("succeeded");
  for (const status of [401, 403, 404, 410]) {
    waits.length = 0;
    const denied = async (method, path, ...rest) => (path.startsWith("/operations/")
      ? problem(status, "denied") : http(method, path, ...rest));
    expect(await followOperation(denied, "op-denied"), String(status)).toEqual({ result: "unknown", id: "op-denied" });
  }
  // A gateway's JSON error while polling is not the Operation's state.
  let gateway = 1;
  const gatewayJson = async (method, path, ...rest) => (path.startsWith("/operations/") && gateway-- > 0
    ? new Response(JSON.stringify({ status: "failed" }), { status: 504, headers: { "content-type": "application/json" } })
    : http(method, path, ...rest));
  waits.length = 0;
  expect((await followOperation(gatewayJson, replayed.operation.id)).result).toBe("succeeded");

  // A Host that never answers is resent only until the replay window ends.
  let attempts = 0;
  const silent = async () => { attempts++; throw new Error("no answer"); };
  expect((await send(silent, update("guide-update-000013", "x", 8, { replayWindowMs: 10_000 }))).result).toBe("unknown");
  expect(attempts).toBeLessThanOrEqual(5);

  // A failed Operation is final and still returns the Resource.
  const failing = async (method, path, ...rest) => (path.startsWith("/operations/")
    ? json({ id: "op-f", resourceUid: uid, status: "failed", effect: "partial" })
    : http(method, path, ...rest));
  const failedResult = await followOperation(failing, "op-f");
  expect(failedResult.result).toBe("failed");
  expect(failedResult.resource.uid).toBe(uid);

  // A proxy's plain JSON error is not the API's Problem, so it is resent too.
  let plain = 1;
  const plainJson = async (...args) => (args[0] === "PUT" && plain-- > 0
    ? new Response(JSON.stringify({ error: "blocked by proxy" }),
      { status: 400, headers: { "content-type": "application/json" } })
    : http(...args));
  expect((await send(plainJson, update("guide-update-000016", "plain", 8))).result).toBe("succeeded");

  // A 404 after an uncertain send, even after a 429, proves nothing.
  const afterLossThen = (status, ...before) => {
    const answers = [...before];
    return async () => {
      const next = answers.shift();
      if (next === "lost") throw new Error("lost");
      return next ?? problem(status, "not_found");
    };
  };
  expect((await send(afterLossThen(404, "lost"), update("guide-update-000019", "x", 9))).result).toBe("unknown");
  expect((await send(afterLossThen(404, problem(429, "rate_limited"), "lost"), update("guide-update-000020", "x", 9))).result)
    .toBe("unknown");

  expect((await send(afterLossThen(404, "lost", problem(429, "rate_limited")), update("guide-update-000022", "x", 9))).result)
    .toBe("unknown");

  // A Resource read that fails after a finished Operation leaves the Resource out.
  const unreadable = async (method, path, ...rest) => (method === "GET" && path.startsWith("/resources/")
    ? Promise.reject(new Error("read lost")) : http(method, path, ...rest));
  const unread = await followOperation(unreadable, replayed.operation.id);
  expect(unread.result).toBe("succeeded");
  expect(unread.resource).toBeNull();

  // By default, polling waits at most ten minutes before returning pending.
  waits.length = 0;
  const longWait = { headers: new Headers({ "Retry-After": "86400" }) };
  await followOperation(http, "op-default-bound", { status: "running" }, longWait);
  expect(waits[0]).toBeGreaterThan(9 * 60_000);
  expect(waits[0]).toBeLessThanOrEqual(10 * 60_000);

  // A Retry-After date in the past falls back to the default wait.
  let pastLimit = 1;
  const past = async (...args) => (args[0] === "PUT" && pastLimit-- > 0
    ? json({ type: "about:blank", title: "slow", status: 429, code: "rate_limited" }, 429,
      { "Retry-After": new Date(Date.now() - 60_000).toUTCString() })
    : http(...args));
  await send(past, update("guide-update-000021", "after past date", 9));
  expect(waits[0]).toBe(1000);

  // Unverifiable private inputs, and a 403 or 410 after an uncertain send, prove nothing.
  let lost403 = false;
  const forbiddenAfterLoss = async () => {
    if (!lost403) { lost403 = true; throw new Error("lost"); }
    return problem(403, "forbidden");
  };
  expect((await send(forbiddenAfterLoss, update("guide-update-000017", "x", 9))).result).toBe("unknown");
  const unverifiable = async () => problem(409, "private_inputs_unverifiable");
  expect((await send(unverifiable, update("guide-update-000014", "x", 9))).result).toBe("unknown");
  let lost410 = false;
  const goneAfterLoss = async () => {
    if (!lost410) { lost410 = true; throw new Error("lost"); }
    return problem(410, "gone");
  };
  expect((await send(goneAfterLoss, update("guide-update-000015", "x", 9))).result).toBe("unknown");

  // Following a Problem's Operation saves its ID first; a long Retry-After never outlasts the bound.
  expect(saved.findLast((record) => record.key === "guide-update-000006")?.operationId).toBe(result.operation.id);
  waits.length = 0;
  const patient = { headers: new Headers({ "Retry-After": "86400" }) };
  await followOperation(http, "op-patient", { status: "running" }, patient, Date.now() + 60_000);
  expect(waits[0]).toBeLessThanOrEqual(60_000);

  // A completed delete returns no Resource.
  const deleted = await send(http, { method: "DELETE", path: `/resources/${uid}`,
    headers: { "Takoform-Expected-Generation": "10" }, key: "guide-delete-000001",
    firstSentAt: Date.now(), replayWindowMs: 3_600_000 });
  expect(deleted.result).toBe("succeeded");
  expect(deleted.resource).toBeNull();

  // After a restart, a saved Operation ID is enough to resume.
  const resumed = await followOperation(http, replayed.operation.id);
  expect(resumed.result).toBe("succeeded");
  expect(resumed.operation.id).toBe(replayed.operation.id);
});

test("the client guide's update and delete intents follow the Resource's generation", async () => {
  const guide = readFileSync(new URL("../../website/client/index.md", import.meta.url), "utf8");
  const [loop, usage, changes] = [...guide.slice(guide.indexOf("{#loop}")).matchAll(/```js\n([\s\S]*?)```/gu)]
    .slice(0, 3).map((match) => match[1]);
  const host = makeHost();
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ method: init.method, headers: init.headers, body: init.body });
    return host({ method: init.method, url, headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body) });
  };
  const program = loop.replace("const sleep = (ms) => new Promise((done) => setTimeout(done, ms));",
    "const sleep = async () => { await new Promise((done) => setImmediate(done)); };")
    + usage.replace('"https://forms.publisher.example/key-value-entry/1.0.0"', JSON.stringify(form))
    + changes + "\nreturn { result, updated, deleted, change };";
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const saved = [];
  const { result, updated, deleted, change } = await new AsyncFunction(
    "fetch", "save", "discovery", "token", "crypto", program)(
    fetch, async (record) => { saved.push(record); }, { baseUrl: root, limits: { replayWindowSeconds: 3600 } },
    "guide-token", globalThis.crypto);

  expect(result.resource.generation).toBe(1);
  expect(updated.result).toBe("succeeded");
  expect(updated.resource.generation).toBe(2);
  expect(updated.resource.spec).toEqual({ key: "greeting", value: "welcome" });
  expect(deleted.result).toBe("succeeded");
  expect(deleted.resource).toBeNull();
  const mutations = sent.filter(({ method }) => method === "PUT" || method === "DELETE");
  expect(mutations.map(({ method, headers }) => [method, headers["Takoform-Expected-Generation"]]))
    .toEqual([["PUT", "1"], ["DELETE", "2"]]);
  const keys = sent.filter(({ method }) => method !== "GET").map(({ headers }) => headers["Idempotency-Key"]);
  expect(new Set(keys).size, "every change uses its own key").toBe(3);
  expect(mutations[1].headers["Content-Type"], "delete sends no Content-Type").toBeUndefined();
  expect(mutations[1].body, "delete sends no body").toBeUndefined();
  expect(saved.filter((record) => record.method !== "POST").every((record) => record.replayWindowMs === 3_600_000),
    "changes carry the replay window in milliseconds").toBe(true);
  expect(() => change(null, "DELETE"), "a change needs a Resource that was read").toThrow("Read the Resource first.");
});

