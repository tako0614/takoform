---
title: Glossary
---

# Glossary

このページは non-normative な用語案内です。canonical English token と、この site での日本語の
説明をそろえるための表です。詳しい意味や検証条件は [Reference](/reference/) から
英語の source をたどってください。

| Canonical token | 日本語での説明 |
| --- | --- |
| `Form` | 一つの portable な service shape を表す desired-state contract。 |
| `Form Definition` | `Form` の identity、desired / observed / output schema、lifecycle capability、relation などを記述する data-only 定義。 |
| `FormRef` | `apiVersion`、`kind`、`definitionVersion`、`schemaDigest` の4要素で一つの Definition を指す exact な参照。 |
| `Form Family` | publisher が管理する versionless な reverse-DNS group。namespace であり、version や catalog ではない。 |
| `Form Package` | 一つの exact な FormRef と、Definition、列挙された data-only payload を閉じ込めた package。 |
| `Core` | Form Package の検証、Snapshot compile、Host API client、trust 検証、generic conformance を提供する Go module。現在の artifact identity は `v1.1.0`。 |
| `Snapshot` | 検証済みの package、Interface、Binding を exact digest で束ね、入力順に依存せず compile した immutable graph。 |
| `Host API` | client と Host の discovery、lifecycle、Operation、fence、error を運ぶ wire contract。現在の lane は `forms.takoform.com/v1`。 |
| `Host` | `Host API` を受け、Form を install して resource lifecycle を実装する側。特定の Host が動いていることは Core の report からは分からない。 |
| `Operation` | 時間のかかる mutation の受付と terminal result を表す record。 |
| `Interface` | resource が公開する operation、input / output、error、consistency などを固定する exact contract。 |
| `Binding` | source と target の間に必要な typed capability と role を digest で固定する contract。 |
| `Artifact` | manifest と blob の content-addressed な data。digest は bytes を指し、権限や credential を与えない。 |
| `Standard Service` | 外部 protocol を sealed slot として要求する参照。protocol の意味と実体化は Host integration 側に残る。 |
| `publisher` | Form や package の source、provenance、release bytes を提供する主体。Core に privileged publisher はない。 |
| `client adapter` | Snapshot と Host API を一つの client の schema、state、import、codec へ写像する実装。 |
| `Conformance` | report が名指した artifact または実装について、決められた性質を確認した証拠。別の能力や公開状態までは含まない。 |
| `trust / revocation` | caller が渡す publisher policy、署名、provenance、revocation の入力と、その offline 検証。 |
| `desired` | 利用者が指定する portable な希望状態。 |
| `observed` | Host が観測して返す状態。desired を別の identity に読み替えるものではない。 |
| `output` | contract が宣言する typed な結果。Host の秘密や内部設定を意味しない。 |
| `schemaDigest` | canonical な Form Definition bytes の SHA-256 digest。FormRef の一部。 |
| `packageDigest` | canonical な package index bytes の SHA-256 digest。配布 bytes の証拠であり、FormRef の identity ではない。 |
| `uid` | Host が一つの resource incarnation に発行する immutable な識別子。delete と recreate で変わる。 |
| `generation` | portable desired state の変更で進む version fence。 |
| `revision` | status や output を含む representation の変更で進む revision fence。 |

FormRef は `official` bit を持たず、publisher を選ぶ中央 catalog も common model の
一部ではありません。検証、installation、Host support、activation、commercial Offering
は別の事実として扱います。
