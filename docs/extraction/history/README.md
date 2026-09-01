# Extracted W09 evidence

This directory preserves byte-exact W09 evidence that is not a current Core
ledger or generator input.

| File | Filtered-head blob | Raw SHA-256 | Disposition |
| --- | --- | --- | --- |
| `specification-compatibility.json` | `9781497155f6ff063c335dfdd9014f4c97180eab` | `2d65b2c0fe9d6ddfb8aa8866fb2e4946be5984402c7cbcf7a6a8f55b12d00faa` | immutable five-class W09 report; mixes Core, Form, Provider, Host, and adoption facts and is never regenerated here |
| `published-document-lanes.json` | `328c7614a64ab9f24293c1a8b0cf467082c39a1b` | `f00211e3f0f943679e27976d2b9d06f96ea534eaeee80430b6e893b20d47dcb3` | pre-extraction mixed ledger; retained only to explain the authority split |
| `specification-1.1-publication-evidence.json` | `0bda938c669e5facecf3def59d951b4469620564` | `6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84` | exact predecessor publication asset source; its embedded paths remain historical facts |
| `publication-blockers-v1beta1.json` | `6aebde9e6e958cdee53201435041cddc0a092e18` | `8bc708163e789b95833331a537abf1c455062179c0eef5b57c583c76b8d740e0` | old v1beta1 Form-package/public-service obligations; not a current Core gate |
| `specification-1.1-publication-policy.md` | `b84cb1e60286037d181ab24aec99b05273205cc5` | `1828286b630758980a1a36c85321f7759c7134aeb05df0bba7953edfd942002c` | predecessor W09 C1-C4 and Provider publication policy; retained byte-exact, never executed here |
| `w08-source-boundary-inventory.md` | `125e003a4d9fac45ec5f0c2b86243ad1bf5a4e15` | `f279a967a2d4435f8452fc2db548af93417a0a641f02fa2f68e8979550a95c70` | pre-extraction official-family/Provider source graph; historical input to W10, not current topology |

All files are copied from filtered history head
`f3ed98a9b967cfed130359a51f56badf11188bd4`. Their paths in the predecessor
repository remain recorded by the complete extraction map. Core checks their
fixed digests but does not treat their contents as current publication truth.

The imported publication receipt deliberately keeps the original asset
`sourcePath` (`spec/publication-evidence.json`). That field records where the
predecessor built the asset; it is not rewritten to this custody path and does
not define a current release lane.

Current version-axis rules are in
[`spec/versioning.md`](../../../spec/versioning.md), the Host API v1 closure is
in [`release/host-api-v1.json`](../../../release/host-api-v1.json), and current
schema identities remain in
[`release/public-schema-identities.json`](../../../release/public-schema-identities.json).
