---
title: Create a Form
---

# Create a Form {#authoring}

A Form describes resource settings and the behavior those settings mean.
Packaging the definition lets publishers, clients and Hosts verify the same
contents. This example builds a small package, validates input and detects a
changed payload.

## Run the example {#run}

Allow about five minutes. You need Go, Git and a network connection for the
initial source and dependency downloads. In an existing checkout, run the last
two commands from the repository root.

```sh
git clone https://github.com/tako0614/takoform.git
cd takoform
go mod download
go test -v ./formpackage -run '^ExampleVerifyFS$' -count=1
```

The test verifies this output and finishes with `PASS`.

```text
GreetingPolicy 1
changed payload rejected: true
```

The example uses a fictional `GreetingPolicy` and local temporary data. It does
not sign or publish a package, or create resources on a Host.

## Define settings and meaning {#definition}

The setting is a greeting prefix of at most 40 characters. Creation stores it
unchanged, updates replace it and deletion removes it. There is no runtime
endpoint.

<<< @/../formpackage/example_test.go#definition{go}

`desiredSchema` validates the input shape. It does not by itself explain what an
update changes or whether an operation can be retried after failure. A real Form
also defines lifecycle behavior, failure handling and any required Interfaces or
Bindings. See [Form Definition](/en/spec/form-definition/) and the
[portability boundary](/en/spec/portability-boundary) for the behavior that can
be offered under the same Form identity.

## Build and verify the package {#package}

This code validates the definition and input, then builds a virtual filesystem
containing `definition.json` and `package-index.json`. `VerifyFS` uses a temporary
directory for verification and removes that directory afterward.

<<< @/../formpackage/example_test.go#authoring{go}

`schemaDigest` identifies the canonicalized definition. Each file's `digest` and
`size` in the index verify the exact packaged bytes. The final part adds a newline
to the definition without updating the index and confirms that verification
rejects the changed payload.

To distribute files, save the same definition and index, with all declared files
and references present. [Form Package](/en/spec/form-package/) defines the index
format and calculation rules.

## Prepare for publication {#publish}

1. Choose a publisher-controlled namespace and define the Form's purpose and behavior.
2. Document settings, updates, deletion, errors and retry rules, and write tests for them.
3. Follow the [compatibility rules](/en/spec/versioning) when choosing a version; do not overwrite published contents.
4. Provide publisher-owned provenance, signatures and revocation information following [Trust and revocation](/en/spec/trust/), alongside examples and limitations.
5. Check that the intended Host implements the exact FormRef and admits it for the intended caller.

Successful signature verification does not decide whether to trust the publisher.
Users and operators supply that policy. Registration in a central Core catalog is
not what makes a Form usable.

Continue with the [common model](/en/model/) to understand references in a
Snapshot, or [use a Host from Go](/en/client/) to try the API calls.
