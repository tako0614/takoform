---
title: 共通モデル
---

# 共通モデル

Takoform の共通モデルは publisher 中立です。誰が Form を書いても、同じ identity 文法、
同じ package 形式、同じ compile 規則、同じ trust 入力を通ります。normative な定義は
[API と共通概念](/spec/) の各 contract document が持ちます。

## identity の文法

| 語 | 何を指すか |
| --- | --- |
| Form Family group | versionless な reverse-DNS 名前空間。path segment 一つとして運ばれ、`/` を含めない |
| FormRef | `apiVersion` / `kind` / `definitionVersion` / `schemaDigest` の四要素 |
| `definitionVersion` | その Form の portable な desired-state 契約の SemVer |
| `schemaDigest` | immutable な Definition の RFC 8785 canonical digest |
| package digest | 配布 bytes の content digest。identity の決定には参加しない audit 証拠 |

group は namespace であって version ではありません。group を変えると digest 束縛の
Definition が変わるので、member 全体が別 identity になります。

## data の層

- [Form Definition](/spec/form-definition/) — 四要素の FormRef と、portable な desired /
  observed / output の形。
- [Form Package](/spec/form-package/) — 一つの exact な Form のための、閉じた data-only
  package。実行コード、credential、配置、商用の内容を持ちません。
- [Immutable Snapshot](/spec/core/) — 検証済みで digest 固定された contract を、順序に
  依存しない immutable graph へ deterministic に compile したもの。失敗したときに
  部分的な Snapshot を返しません。
- [Interface contract](/spec/interface-contract/) と
  [Binding contract](/spec/binding-contract/) — digest 束縛の data contract。名前や
  「互換に見える」ことから binding を推測する実装はありません。
- [Artifact transport](/spec/artifact-transport/) — content addressed な manifest と blob。
  digest は bytes を指し、権限を指しません。
- [Standard services](/spec/standard-services/) — sealed slot と、opaque に正規化された
  reverse-DNS の protocol identifier。中央 enum はありません。
- [Trust と revocation](/spec/trust/) — caller が渡す provenance と、offline の検証入力。

## version 軸は二つだけ

| 対象 | identifier | 意味 |
| --- | --- | --- |
| Host API lane | `forms.takoform.com/v1` のような exact な wire major | Host discovery と wire document の互換性 |
| Form definition | 一つの FormRef の `definitionVersion` | その Form の desired-state 契約の互換性 |

package の `$id`、schema の `$id`、Interface / Binding ref、trust の記録、client の
release identity、library の SemVer は、それぞれ自分の bytes か reader を指す
identity です。追加の Takoform version 軸として提示してはいけません。詳細は
[Versioning and compatibility](/spec/versioning) にあります。

## publisher の平等

すべての publisher が同じ FormRef、package 検証、canonical digest、trust、revocation、
Snapshot、installation、Host support、activation の経路を通ります。provenance と policy を
選ぶのは operator であり、特権 allowlist も `official` bit もありません。

検証、installation、support、activation、商用 offering は、それぞれ独立した事実です。
一つが真でも他は導けません。
