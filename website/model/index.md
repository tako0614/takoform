---
title: 共通モデル
---

# 共通モデル

このページは non-normative な案内です。Takoform の common model は publisher 中立で、
誰が Form を書いても同じ identity 文法、package 形式、compile 規則、trust 入力を通ります。
意味の正本は [API と共通概念](/spec/) からたどれる English contract document です。

## identity の文法

| 語 | 何を指すか |
| --- | --- |
| Form Family group | versionless な reverse-DNS namespace。path の一つの segment として運ばれ、`/` を含めない |
| FormRef | `apiVersion` / `kind` / `definitionVersion` / `schemaDigest` の四要素 |
| `definitionVersion` | その Form の portable な desired-state contract の SemVer |
| `schemaDigest` | immutable な Definition の RFC 8785 canonical digest |
| package digest | 配布 bytes の content digest。FormRef の equality には参加しない audit evidence |

group は namespace であって version ではありません。group を変えると digest で束縛された
Definition が変わり、別の Form identity になります。

## data の層

- [Form Definition](/spec/form-definition/) — 四要素の FormRef と portable な desired /
  observed / output の形。
- [Form Package](/spec/form-package/) — 一つの exact な Form のための、閉じた data-only
  package。
- [Immutable Snapshot](/spec/core/) — 検証済みで digest 固定された contract を、順序に
  依存しない immutable graph へ deterministic に compile したもの。失敗時に部分的な
  Snapshot を返しません。
- [Interface contract](/spec/interface-contract/) と [Binding contract](/spec/binding-contract/)
  — exact digest に束縛された data contract。名前や「互換に見える」ことから binding を
  推測しません。
- [Artifact transport](/spec/artifact-transport/) — content-addressed な manifest と blob。
  digest は bytes を指し、権限を指しません。
- [Standard services](/spec/standard-services/) — sealed slot と opaque な reverse-DNS
  protocol identifier。中央 enum はありません。
- [Trust と revocation](/spec/trust/) — caller が渡す provenance と offline verification の入力。

## named stream は四つ、domain axis は二つ

Takoform が扱う version の名前付き stream は四つです。そのうち、portable な意味の
互換性を表す domain axis は Host API lane と Form definition の二つだけです。

| named stream | identifier | 区分 |
| --- | --- | --- |
| Host API lane | `forms.takoform.com/v1` | domain axis: Host discovery / wire compatibility |
| Form definition | 一つの FormRef の `definitionVersion` | domain axis: その Form の desired-state compatibility |
| Core module | `v1.1.0` | software artifact: SDK、CLI、verifier、compiler、client |
| Provider | 独立した SemVer | software artifact: Terraform / OpenTofu client |

Core や Provider の release は Host lane や Form identity を動かしません。package の
`$id`、schema の `$id`、Interface / Binding ref、trust record、client release identity は、
それぞれ自分の bytes または reader を識別します。これらを三つ目以降の domain version
axis として数えません。Host API に minor lane はありません。

## publisher の平等

すべての publisher が同じ FormRef、package 検証、canonical digest、trust、revocation、
Snapshot、installation、Host support、activation の経路を通ります。provenance と policy を
選ぶのは operator で、Core に privileged publisher allowlist や `official` bit はありません。

検証、installation、support、activation、commercial Offering は、それぞれ独立した事実です。
一つが真でも、ほかを導くことはできません。

## 次に読む

- [Host API v1 とは](/host-api/) — wire identity と lifecycle。
- [Start](/start/) — package から Snapshot までの synthetic journey。
- [Versioning and compatibility](/spec/versioning) — frozen source の詳しい規則。
- [Glossary](/glossary) — canonical English token の日本語説明。
