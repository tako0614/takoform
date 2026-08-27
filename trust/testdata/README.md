# Offline Sigstore fixture provenance

These files are public verification material copied byte-for-byte from the
predecessor repository at immutable commit
`1fa34160a4ed152443b4ea424a324f7677716e36`:

- `cosign-v3.0.6-message-signature.sigstore.json` came from the predecessor
  [`cmd/form-package-release/testdata/`](https://github.com/tako0614/terraform-provider-takoform/tree/1fa34160a4ed152443b4ea424a324f7677716e36/cmd/form-package-release/testdata)
  (SHA-256 `d884757a24fe2fe6f6b4bcc317d42341bcacca5ee42c8eb13c78b8eb05642e01`).
- `trusted-root.json` came from the predecessor
  [`release/trust/trusted-root.json`](https://github.com/tako0614/terraform-provider-takoform/blob/1fa34160a4ed152443b4ea424a324f7677716e36/release/trust/trusted-root.json)
  (SHA-256 `6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66`).
- `subject.txt` records the exact signed UTF-8 bytes described by the
  predecessor fixture: `Takoform Cosign v3 bundle shape probe` followed by LF.

The bundle was produced by Cosign v3.0.6 in public GitHub Actions run
29668147384. It contains an ephemeral Fulcio certificate, the blob signature,
Rekor inclusion proof, and timestamp verification data. It contains no private
key, OIDC token, credential, or repository secret. These are retained
predecessor fixtures, not a current publisher workflow or trust default.
