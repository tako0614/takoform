---
title: Use a Host from Go
---

# Use a Host from Go {#client}

Core's `hostclient` discovers a Host, checks Form availability, prepares changes
and creates or updates resources. For asynchronous responses it waits for the
Operation to finish. Start by trying the call sequence against a local HTTP test
fixture.

## Run locally {#run}

Allow about five minutes. You need Go, Git and a network connection for the initial
source and dependency downloads. In an existing checkout, run the last two
commands from the repository root.

```sh
git clone https://github.com/tako0614/takoform.git
cd takoform
go mod download
go test -v ./hostclient -run '^ExampleClient_ApplyResource$' -count=1
```

The test verifies this output and finishes with `PASS`.

```text
greeting example-uid true
discovery -> availability -> prepare -> apply
```

The loopback test server uses a fictional Form and fixed responses. It needs no
credentials, external service or durable data. It teaches client calls; it is not
a deployable Host implementation.

## Call the client {#call}

<<< @/../hostclient/example_test.go#client{go}

1. Pass the Host origin and authentication token to `New`. The token is empty in this test.
2. `Discover` checks the API endpoint and required features.
3. `ApplyResource` checks support and admission for the exact FormRef, then uses the `prepare` result to create the resource.
4. This example completes synchronously with `201 Created`. If a real Host returns
   `202 Accepted`, the same method polls the Operation until completion.

Read the full code, including the fixture server, in
[`hostclient/example_test.go`](https://github.com/tako0614/takoform/blob/main/hostclient/example_test.go).
For wire-format examples, see [Host API requests and responses](/en/start/#_3-host-apiの要求・応答例を読む).

## Before using a real Host {#real-host}

| Requirement | What to check |
| --- | --- |
| Host origin and authentication | Obtain these from the Host's documentation. A Form Family namespace is not an endpoint |
| FormRef and settings | Use the exact version and digest from a verified definition, with input matching that definition |
| Space and resource name | Select the scope and name you intend to manage |
| Permission | Confirm that the Host admits the Form and operation for the current caller |

The current `hostclient` rejects a prepare response that adds omitted defaults.
For a Form with defaults, build a Snapshot from the exact package admitted under
your trust policy, call `Snapshot.Materialize` to fill defaults, and pass the
result as `Resource.Spec`. Decode that JSON into `map[string]any` with
`formpackage.DecodeStrictIJSON`. This workaround addresses schema defaults only.
The current client also rejects a changed prepare echo when a Host canonicalizes
settings such as hostnames. There is still an implementation gap with Host API
v1's required Host-side materialization/canonicalization and client acceptance.
The fixture Form on this page has neither defaults nor canonicalization.

Only then replace `server.URL`, the token and `desired`. Applying to a real Host
changes resources. Keep credentials out of source files and logs.

## Handle updates and failures {#changes}

An empty `Fence` requests creation. For an update, pass the UID and generation
from a retrieved Resource into `Fence` to avoid overwriting concurrent changes.
Do not increment generation by hand.

A timeout does not mean that nothing changed. Inspect the Resource or Operation
before retrying. See [Host API v1](/en/spec/host-api/v1) for the contract, the
[Host API overview](/en/host-api/) for implementation context and
[Conformance checks](/en/conformance/) for verification scope.
