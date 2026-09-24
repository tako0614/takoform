# W10 Core extraction records

This directory preserves the extraction evidence that moved the neutral Core
source into this repository. These are receipts and byte maps, not current
contract or release authority.

- [`w10-core-cutover.md`](w10-core-cutover.md) records the non-destructive
  extraction and authority cutover, with the fixed source identities.
- [`source-path-map.json`](source-path-map.json) is the complete byte map
  between the predecessor and extracted trees.
- [`filter-repo-commit-map.txt`](filter-repo-commit-map.txt) is the complete
  `git-filter-repo` commit map.
- [`history/`](history/) holds the byte-pinned predecessor evidence files.
  Their contents are historical facts — including paths and commands of the
  predecessor repository — and are not current publication truth.
