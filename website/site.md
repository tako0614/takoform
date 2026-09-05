---
title: この site について
---

# この site について

このページは non-normative な案内です。

この site は、Takoform の Host API v1 と publisher 中立な common model を読むための
入口です。site の案内文は contract そのものではありません。

## この repository が扱う範囲

[`tako0614/takoform`](https://github.com/tako0614/takoform) が、この site の source、build、
deploy entrypoint と、次の public surface を所有します。

- `forms.takoform.com/v1` の Host API contract と machine document
- FormRef、Form Definition、Form Package、Snapshot、Interface、Binding、artifact、
  standard service、trust の publisher-neutral contract
- `$id` が名指す path で配信する公開 schema の exact bytes
- conformance language と synthetic corpus の読み方

Host API v1 の frozen closure は
[`spec/host-api/v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json)
が列挙します。schema identity と digest の append-only な記録は
[`release/public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json)
にあります。

## この site が主張しないこと

この site は次を配信・選択・証明しません。

- 個別 Form の definition、実運用の example、publisher catalog や roster
- Host implementation、Host support、activation、backend、target、credential
- client adapter の対応状況、商用 Offering、billing、quota、SLA
- realized な DNS、CDN、account、zone、route、operator configuration

それぞれの事実は、その事実を実際に所有・実行した publisher、Host、client、operator が
自分の source と readback で示します。ここにある conformance report だけから、別の事実を
推測しません。

## identity と配信

公開 schema の `$id` は論理的な identity です。この site は、その `$id` が示す path と
同じ path で、ledger が固定した bytes を配信します。どの hostname を実際にこの site へ
向けるか、どの account から配信するかは公開 operator の判断です。

schema bytes の変更ではなく、presentation page の変更だけであっても、build と readback
の結果を別の evidence として扱います。過去の site や別の publisher の page を、この site
の current contract として再掲しません。

## source を読む

- [Reference](/reference/) — English / normative source と Japanese / non-normative guide の区別
- [Start](/start/) — 実行できる synthetic verification と概念 transcript
- [公開 schema](/schemas/) — `$id` と digest の index
- [`docs/site.md`](https://github.com/tako0614/takoform/blob/main/docs/site.md) — source repository の
  build / publish procedure

この site の所有境界や operator の realized state が必要な場合は、上の source repository と
operator の記録を一緒に確認してください。
