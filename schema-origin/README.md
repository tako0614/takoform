# Takoform schema origin

This directory is the Core-owned, static-assets-only source for the later
`forms.takoform.com/schemas/*` route. `wrangler.jsonc` intentionally has no
`main`, asset binding, runtime binding, customer traffic handler, or proxy
logic. `workers_dev` and preview URLs are explicitly disabled.

## Closed projection

`public/` is a deterministic byte projection of the **active** entries in
`../release/public-schema-identities.json`:

```text
ledger identity id pathname /schemas/x/y.schema.json
  -> schema-origin/public/schemas/x/y.schema.json
```

The source bytes come from each entry's `spec/schemas/*.json` path. Retired
entries are history only and are never projected. The projection checker
rejects changed or missing bytes, extra files/directories, duplicate identity
or path records, traversal/non-canonical paths, and symlinks. `--write` first
validates all sources and the output root, refuses symlinks or special files,
then deletes only the contents of this exact `schema-origin/public` root before
writing the closed set.

Run the two modes from the repository root:

```sh
node scripts/schema-origin-projection.mjs --check
node scripts/schema-origin-projection.mjs --write
```

At the initial cutover the check reports exactly 31 active schema assets and
their exact source bytes. The imported 31-entry prefix can never shrink;
future Host API v1 schema additions may append active identities without
changing this projection code. The initial count is the 31-live-byte preflight for a
future route change; this task does not deploy or mutate routes.

## Route coexistence and scope

The existing `takoform-website` Worker currently owns the custom-domain
`forms.takoform.com` origin used by the host/apex docs and other website
traffic. Cloudflare evaluates a more-specific route before that custom-domain
origin, so once an owner-local deploy creates this route, only
`/schemas/*` is selected for this Worker and the old custom-domain behavior
continues elsewhere on the host. The path route is deliberately a route with
`zone_name: "takoform.com"`, not another custom domain.

This origin serves schema JSON only. It does not define, proxy, or imply a
Host API v2 endpoint, and it does not serve host/apex documentation.

Route mutation belongs only to the owning repository's later, owner-local
deploy. Before that mutation, the deploy operator must run the exact
31-live-byte projection preflight and independently verify the resulting
route/post-conditions. A green local projection check is not a deployment
approval.
