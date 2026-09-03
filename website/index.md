---
layout: home
title: Takoform
hero:
  name: Takoform
  text: portable な resource contract
  tagline: publisher が desired state を一度書き、client と Host が同じ exact な bytes を読む。data だけで閉じた契約。
  actions:
    - theme: brand
      text: Host API v1 を読む
      link: /host-api/
    - theme: alt
      text: API と概念
      link: /spec/
    - theme: alt
      text: 公開 schema
      link: /schemas/
features:
  - title: 一つの wire 契約
    details: forms.takoform.com/v1 は discovery、lifecycle、非同期 Operation、identity fence、閉じた error 語彙を定義します。Form の種類を wire に埋め込みません。
  - title: 四要素の exact な identity
    details: FormRef は apiVersion、kind、definitionVersion、schemaDigest の四つで一つの Form を指します。latest も、省略も、別名もありません。
  - title: publisher 平等
    details: どの publisher も同じ package 検証、trust、revocation、installation、support の経路を通ります。特権 allowlist も official bit もありません。
---

## この site が配信するもの

- Host API v1 の normative な wire 契約と、その machine document の digest
- publisher 中立な共通モデル（FormRef、Form Definition、Form Package、Snapshot、Interface / Binding / artifact / standard service）
- `$id` が名指す path で配信される [公開 schema](/schemas/) の exact な bytes
- [conformance の語彙と class](/conformance/)、参照 harness の使い方
- Host API と Form の version を混同しないための互換性ルール

## 配信しないもの

Form definition、Form ごとの example、publisher の catalog や roster、Form 固有の
conformance report、client adapter の resource page はここにありません。それぞれを
所有する publisher と adapter が自分の site から公開します。Takoform はそれらを
中央 catalog として再公開しません。

Host の support、Form の activation、商用 offering、realized な DNS / CDN / account の
状態も、この site の主張ではありません。詳しくは [この site について](/site) を
読んでください。

## 実験的な project です

Takoform は中立な resource-contract の実験です。conformance に通ったという事実は、
その artifact または実装についての証拠であって、公開、support、production readiness の
どれも与えません。
