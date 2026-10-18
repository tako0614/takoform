# Site development and publication

This repository owns the source, build and deploy entrypoint for `takoform.com`.
The site documents the common API and model. Individual Form definitions,
publisher catalogs, Host status and client installation instructions belong to
their respective owners. The operator owns hosting accounts, domains and
credentials.

## Edit the right source

| Content | Source | Generated output |
| --- | --- | --- |
| Overview, guides and version entry pages | Hand-authored `website/` pages and `.vitepress/theme/components/HomePage.vue` | Rendered site |
| Retained v1 specification | Freeze-listed documents under `spec/` | `website/spec/` mirrors |
| v2 specification, examples and migration guide | Explicit `V2_SPEC_DOCUMENTS` in [site.mjs](../scripts/site.mjs) | `website/spec/host-api/v2/` mirrors |
| Raw v2 normative source | The three fixed v2 normative documents | `website/public/_source/host-api/v2/*.md.txt` |
| JSON schemas | Sources named by [public-schema-identities.json](../release/public-schema-identities.json) | `website/public/schemas/` and `website/schemas/index.md` |
| Legacy English URL redirects | Route inventory in `scripts/site.mjs` | `website/public/_redirects` |
| Response headers and robots | `website/public/_headers` and `website/public/robots.txt` | Copied unchanged into the build |

Generated files are regenerated and compared with their sources. The writer
also removes obsolete generated output; adding a file under `website/` does
not automatically make it a published route. Use the explicit route inventory
in `scripts/site.mjs` when adding a page.

The [v1 freeze](../spec/host-api/v1.freeze.json) fixes its normative prose,
machine roots and schema closure. The [v2 freeze](../spec/host-api/v2.freeze.json)
fixes its model, HTTP API and Form requirements. The freeze checker verifies
their Git history, including the already completed v2 editorial correction.
It does not permit further edits to those bytes. v2 examples and migration
guidance are explanatory and remain editable.

## Generate and preview

From the repository root:

```console
bun install --frozen-lockfile
bun scripts/site.mjs --write
bun run check:site
bun run build:site
bun run site:preview
```

`site:preview` serves the built candidate locally. For interactive editing, use
`bun run site:dev`. Run `bun run check` before handing off the final candidate;
it includes the site checks and build alongside the Go and record checks.

`check:site` compares derived pages and schema bytes. `build:site` checks the
rendered pages for metadata, language, document authority, duplicate IDs,
ARIA references, English accessible names without `{#id}` or backtick syntax,
headings in the main content that deepen one level at a time, internal routes
and fragments, and reachability from the overview. A successful build does
not establish publication or Host support.

The v2 walkthrough uses fictional HTTP exchanges. Its examples are not run
against a real Host. The Go documentation tests validate the retained v1
exchanges in `hostclient/testdata/v1-http-exchange.md`. The separate v2 baseline
probe and its limits are documented in [conformance/v2](../conformance/v2/).

## Navigation and local browser checks

The overview explains Form, Host and client roles without a sidebar. `/v1/`
and `/v2/` are version-specific documentation entries; shared pages remain
neutral. [versions.mjs](../website/.vitepress/versions.mjs) assigns each route
to a version for navigation and search. A version change uses the destination
entry when there is no corresponding page and does not carry unrelated fragments.

All visible site text, controls and accessible names are English. Heading
permalinks are named from the rendered heading text, so a custom `{#id}` never
reaches a screen reader. A heading that skips a level, such as an h3 straight
after the page title, renders one level below the heading it falls under, so
the outline deepens one level at a time; the Markdown and the heading's ID do
not change. Former `/en/` pages redirect to their canonical root
URLs. Headings that kept a Japanese fragment ID until the site became
English-only now use an English ID and keep the old one as an alias, so
those links remain valid; IDs dropped in earlier rewrites were not restored.
Both API versions display their English normative source separately from
explanation. Public JSON paths and bytes remain fixed.

Presentation changes also use the explicit browser lane:

```console
bun run check:site:browser
```

It builds the site, serves it on a temporary loopback port and launches an
installed Chrome or Chromium with an isolated profile. If the browser is not
autodetected, set `TAKOFORM_BROWSER` to its absolute executable path. The lane
does not download a browser or require a live Host.

Checks cover 320, 375, 414 and 768 px layouts, including the overview's
walkthrough link within the first 900 px at each width; version-specific
sidebars; keyboard disclosures and focus return; scoped search, with its empty,
truncated and widened states at 375 px; the not-found page, including a missing
page under a versioned path; legacy redirects; English accessible names at
runtime; and desktop light/dark themes, where the lifecycle step targets, the
unclipped create request and recognisable specification source links are also
checked. HTTP errors, JavaScript errors and unexpected external requests fail
the check. Inspect actual light/dark rendering when evaluating the visual
result. The portable `bun run check` does not require a browser binary.

[design.md](../design.md) records the visual direction. `.hallmark/` records
design history; those records are neither published assets nor evidence that
the current candidate passed a browser check.

## Served paths

| Paths | Content |
| --- | --- |
| `/`, `/site` | Shared overview and site information |
| `/v2/`, `/start/`, `/guides/`, `/model/`, `/client/`, `/authoring/`, `/use/`, `/host-api/`, `/glossary` | v2 entry and guides |
| `/spec/host-api/v2/**` | v2 normative mirrors and explanatory examples/migration |
| `/_source/host-api/v2/*.md.txt` | Exact raw English v2 normative source |
| `/v1/`, retained `/spec/**`, `/conformance/` | v1 entry, contracts and verification guidance |
| `/schemas/` | Explanatory schema index |
| `/schemas/**` | All ledgered schema bytes, including retained retired identities |
| Previously published `/en/` routes | Explicit same-origin 301 redirects |
| `/sitemap.xml`, `/robots.txt`, `/404.html` | Site support files |

The removed `/spec/` and `/spec/host-api/` index routes are not regenerated.
Unlisted old routes remain absent rather than using a wildcard redirect. The
site does not serve a Host discovery response: discovery endpoints belong to
an actual Host. Site status, catalog, decision and numbered document-set
routes are also absent.

`retired` in the schema ledger means an identity cannot be issued for new
documents. Its occupied path and original bytes remain available for existing
readers. There are currently 33 non-retired and 15 retired schema identities;
the deploy verifier reads all 48, not a sample. The non-retired section mixes
authoring and retained-readable profiles; it is not a list of v2 schemas.

## Operator publication workflow

These commands describe the existing entrypoint. Publication is a separate
operator action; a branch, PR or successful check does not authorize it.
The live contract is available without side effects:

```console
bun run deploy -- --contract
```

The operator supplies an installed Wrangler and its logged-in profile, an
existing `takoform-site` Pages project with production branch `main`, and the
configured domains. The entrypoint does not create the project, move domains
or provision credentials. A read-only project-list preflight verifies the
profile and target before any upload.

### Preview environments

```console
bun run deploy -- takoform-site --status
bun run deploy -- takoform-site --apply --environment integration
bun run deploy -- takoform-site --apply --environment integration --execute
```

`--status` reads provider project state. Without `--execute`, `--apply` prints
a plan without reading the provider or uploading. Integration and rehearsal
allow a dirty worktree and use a non-production branch; `--branch` selects a
preview branch. `main` is refused for these environments.

An executed apply runs the scoped freeze, site and build checks, uploads once,
and reads the exact pages, v2 raw sources, redirects and all schema bytes at the
immutable deployment URL. It also checks that removed routes remain absent.
The preview does not update the public apex.

### Routine production

```console
bun run deploy -- takoform-site --apply --environment production
bun run deploy -- takoform-site --apply --environment production --execute
```

Production requires a clean local `main` at the exact credential-free public
`main` commit and existing successful production history. Before and after
building, it verifies the prior deployment and public aliases. Prior v2 raw
sources must match either the fixed current edition or the complete original
editorial predecessor; mixed sets are refused. Rendered presentation may differ.

After the single upload, readback checks the immutable deployment, pages and
raw sources at `takoform.com` and `www.takoform.com`, redirects, absent routes,
and every schema byte at `forms.takoform.com`. The source commit, artifact
digest, immutable URL and results are printed. Provider writes must be
serialized by the operator; the entrypoint does not provide an atomic lock.

### Failure and recovery

Failures before upload refuse to touch the target. Upload failures preserve
provider diagnostics and report that target state may be indeterminate.
Missing deployment URLs or readback mismatches halt the run. There is no blind
retry or automatic rollback.

An earlier deployment is offered as a rollback candidate only after its own
rendered pages and raw sources match the public aliases, its raw normative
sources qualify as a complete edition, and all schema bytes and retained v1
pages are preserved. Provider history alone does not prove those conditions.
If no candidate qualifies, repair forward while preserving the fixed contracts
and all schema identities. Response headers for specification routes use
`no-transform`; schema routes retain their separate CORS and caching settings.

### Historical initial cutover

`takoform-api-v1-cutover` is retained historical machinery. The current v2 site
projection refuses its apply path before provider mutation. Routine site
updates do not accept `--initial-cutover` or `--verify-cutover`. Its historical
31-present/17-absent schema partition is not today's schema inventory. The
predecessor Worker cannot serve all 48 identities and is not a rollback target.
See [site-deploy.mjs](../scripts/site-deploy.mjs) for the retained implementation
and [the deploy contract](../scripts/deploy.mjs) for its declared obligations.

Keep credentials, realized configuration and deployment receipts outside the
repository. CI runs read-only checks and does not publish to production.
