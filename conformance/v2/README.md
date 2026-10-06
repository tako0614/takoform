# Host API v2 HTTP baseline probe

`host-api.mjs` is a caller-driven, Form-neutral protocol probe for the mandatory HTTP lifecycle in [`spec/host-api/v2/http.md`](../../spec/host-api/v2/http.md). It is not a Host implementation, SDK, Form verifier, or certification. The repository test uses an in-memory fake only to prove that the probe detects broken responses; it is **not** evidence about any real Host.

The caller supplies an HTTPS origin, an explicitly disposable and authorized Form fixture, and a transport returning standard `Response` objects. The fixture needs a supported version-fixed `form`, a distinct truly unsupported `unknownForm`, a caller-owned `space` and unique `name`, and a Form-valid `spec`. Set `disposable: true` deliberately. If the Host advertises Offerings, also supply the selected `{id,revision}`; the probe checks it against the Offering list. If the Form requires private inputs, supply `privateInputs` and ensure both Host and Support advertise the capability. The caller is responsible for provisioning, authorization, external effects, and cleanup after failure.

```js
import { runHostApiV2 } from "./host-api.mjs";

const result = await runHostApiV2({
  origin: "https://host.example",
  fixture: {
    disposable: true,
    form: "https://publisher.example/forms/example/0.1.0",
    unknownForm: "https://publisher.example/forms/unimplemented/0.1.0",
    space: "my-disposable-space",
    name: "unique-test-name",
    spec: { /* Form-valid desired spec */ },
  },
  transport: async ({ method, url, headers, body, authenticated, signal }) => {
    // Implement Host-declared authentication here. Do not authenticate discovery.
    const requestHeaders = authenticated ? authorize(headers) : headers;
    return fetch(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      redirect: "manual",
    });
  },
});
```

No CLI, implicit `fetch`, credential lookup, or automatic live run exists. The transport receives `authenticated:false` only for discovery. It must implement the Host's declared scheme; the probe neither assumes Bearer nor proves authentication/authorization isolation. Do not log request bodies or headers: they can contain private inputs and credentials. The probe's own errors include only a step and fixed reason/status, not response bodies or transport exceptions.

The baseline exercises discovery and Support (including an unknown Form), an unknown-Form create refusal, optional Offering selection when advertised, create/GET/list/update/delete with the same UID and advancing generations, Operation GET, same-key replay and changed-input conflict, stale-generation rejection, and deletion visibility. It has finite request timeouts and poll/page bounds. A terminal Operation must succeed within those bounds; adjust `maxPolls`, `pollDelayMs`, and `timeoutMs` for the test Host. This is an active mutating test against the injected transport.

The common protocol does not define Form-specific `spec` normalization. Supply `expectedSpec` to compare structurally with the returned Resource spec, or `assertResource(resource)` for Form-specific checks; without either, only the common Resource fields are checked. The callback must return `true` on success. Callback errors are masked so private input values cannot reach probe diagnostics.

`baseline:"passed"` means only that sequence passed. `fullConformance` is always `false`; the result separately marks restart durability, fault injection, concurrent requests, cross-principal authority, optional-feature edge cases, and Form-specific behavior as `not-tested`. In particular, this probe does not validate §10's lost-response/process-restart experiment or prove retention over real elapsed time. Those require Host-owned qualification hooks and evidence.
