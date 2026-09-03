# Content-addressed artifact transport (`artifacts.takoform.com/v1alpha1`)

Artifact transport carries immutable, data-only manifests and blobs. Desired
state references a manifest digest; raw bytes, upload endpoints, and transport
metadata do not become part of a Form identity. A digest identifies bytes, not
authority or access.

The Host API v1 operation table
[`operations-v1.json`](../host-api/operations-v1.json) defines the transport
routes. The manifest's structural profile is
[`artifact-manifest-v1alpha1.schema.json`](../schemas/artifact-manifest-v1alpha1.schema.json).
The artifact identity remains independent of Form definition versions, package
publication, client projection, and Host adoption.

## Endpoints

Relative to the discovered `endpoints.api` base
(`/apis/forms.takoform.com/v1`):

```text
POST   {api}/artifacts/uploads                         start an upload
PUT    {api}/artifacts/uploads/{uploadId}/blobs/{sha256}  upload one missing blob
POST   {api}/artifacts/uploads/{uploadId}/commit       verify and commit the manifest
GET    {api}/artifacts/{manifestDigest}                read a committed manifest
HEAD   {api}/artifacts/blobs/{sha256}                  probe blob presence
DELETE {api}/artifacts/uploads/{uploadId}              abandon an incomplete upload
```

The request and response envelopes are defined by Host API v1. A Host owns
storage, retention, upload authorization, and tenant isolation; the transport
contract does not choose those policies.

## Upload flow

1. The caller computes a SHA-256 digest for each local file and builds a typed
   manifest.
2. `POST /artifacts/uploads` submits that manifest and returns an upload handle
   plus the blobs the Host does not hold.
3. The caller uploads only missing blobs. The Host verifies each received size
   and digest.
4. `POST .../commit` re-verifies the manifest and every blob (size, digest,
   media type, path grammar, and any manifest-kind rules) and returns the
   immutable RFC 8785 `manifestDigest`.
5. Desired state references the digest only.

Uploads MAY be resumed. Repeating the start request with the same manifest
returns the still-missing set, and committing an already committed manifest is
idempotent. An abandoned handle MAY be collected; a committed manifest and
its blobs MUST remain readable while an addressed resource references them.

## Commit validation

A Host MUST reject before commit:

- duplicate entry names and invalid UTF-8;
- absolute, traversal, dot-segment, backslash, NUL, or otherwise non-canonical
  paths;
- media types outside the manifest kind's declared policy;
- size or digest mismatches;
- count or aggregate-size limits exceeded by the Host's advertised profile;
- a manifest whose kind-specific payload shape is invalid; and
- archives that attempt to hide additional semantic files (archives are
  transport only).

Rejections use `artifact_invalid` (400); a referenced blob or manifest that is
not committed or not held by the caller's tenant uses `artifact_missing` (404).
Every rule is checked again at commit because commit mints the immutable
identity. A Host MUST NOT rely only on checks performed at upload start.

The manifest schema is a structural minimum. A manifest kind may define
additional data-only rules in its own contract, but it may not introduce
credentials, endpoints, executable code, or Host identity into the portable
bytes.

## Referencing a manifest

An artifact-backed Form carries the manifest digest as its desired-state
reference. Before mutation, and again when an accepted asynchronous operation
commits, a Host resolves the exact digest and rejects it when the manifest is
unknown, not held by the caller's tenant, fails canonicalization, has a
different kind than the referring contract requires, or violates the
manifest-kind rules. Unknown and foreign digests intentionally have the same
`artifact_missing` response.

A committed manifest and each referenced blob MUST stay readable while any
resource references them. Garbage-collecting an unrelated upload or abandoning
an upload handle MUST NOT make a committed reference unresolvable.

## Artifact guarantees and Host responsibilities

- Manifests are data-only and contain no credentials, endpoints, or Host
  identities.
- A manifest digest is immutable; the same digest names the same canonical
  bytes on every conforming Host that holds it.
- Blob storage, deduplication, retention, and tenant policy are Host-owned.
- A transport digest does not grant lifecycle authority over a resource.
