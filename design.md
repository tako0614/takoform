# Takoform documentation design

Approved direction: an explanatory Takoform overview with version selection in
the header. This is a documentation interface, not a product marketing
page. Its readers are Form authors, Host implementers and client implementers.

## Shared system

- Genre: modern-minimal, technical and restrained.
- Home: explain the shared resource/Form/Host/client model, illustrate a management
  request and its lifecycle, then offer reader-specific guides. Do not add a
  version list, catalogue-status panel or extra index layer.
- Documentation: long-document layout with a version-scoped sidebar and outline.
- Preserve VitePress's installed sans/mono fonts, light/dark palette, search
  launcher, language switch, footer and keyboard conventions. Do not rotate themes.
- Colours reference existing `--vp-c-*` tokens; fonts reference
  `--vp-font-family-base` and `--vp-font-family-mono`. No external fonts or imagery.
- Home spacing uses named local tokens in `website/.vitepress/theme/home.css`.
  Controls use a minimum 44px touch target and an immediate visible focus ring.
- No decorative motion, hero illustration, fabricated metrics, fake browser chrome,
  new logo, or branding assets. Existing prose and code remain selectable text.

## Information architecture

The root is the actual Takoform overview, not a catalogue or secondary index. Primary
navigation contains Overview and a separate API version selector. Keep publication
status chatter out of the reading interface; the normative source and its language
remain identified on specification pages. The home title, subtitle and section
headings are English in both locales, with localized explanatory prose.

`/v1/` and `/v2/` are the documentation entries. Existing guide and specification
URLs remain reachable; a single route classifier assigns their version. v1 pages
must not inherit v2 guides in the sidebar or previous/next navigation. Normative
prose, raw sources and JSON schemas are not rewritten for presentation. The separately
approved v2 editorial correction preserves protocol meaning and v1 bytes.

Every documentation page identifies its version separately from its language.
Switch versions using explicit equivalent-page mappings only; when no equivalent
exists, use the selected version's entry without carrying an unrelated fragment.
Migration links explicitly name the other version. Shared pages remain neutral and
do not acquire a version-specific sidebar by default.

Search defaults to the page's version, or all versions on a neutral page. Readers
can explicitly choose another scope. Filter the actual matches before truncating
results, label each result's version, and preserve language. Keep focus trapping,
Escape, arrow navigation, loading, empty and failure states accessible.

## Acceptance

Check source ownership, v1 frozen bytes, complete route/fragment reachability,
version-scoped navigation, language round trips, search scoping and clear labels.
Use 320/375/414/768px layouts and desktop light/dark browser checks. Build/CI,
local browser evidence and production publication are distinct outcomes.
