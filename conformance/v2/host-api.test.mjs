import { expect, test } from "bun:test";

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
