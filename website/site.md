---
title: この site について
---

# この site について

`takoform.com` は、Takoform の Host API v1 と publisher 中立な共通モデルだけを配信します。

## 誰が所有するか

この site の source、build、deploy entrypoint は
[`tako0614/takoform`](https://github.com/tako0614/takoform) にあります。同じ repository が
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json)
に列挙された normative な Host API v1/common-model 契約、exact な公開 schema、
conformance contract を所有します。`/spec/` 配下でも overview、navigation、schema
index は明示的に non-normative で、この hand-authored page も presentation です。

realized な CDN、DNS、account / zone / route、credential、operator の状態は、source
repository の authority ではありません。公開を行う operator が所有します。この site は
どの hostname が実際に解決するかを主張しません。

## 何を配信し、何を配信しないか

配信するもの:

- Host API v1 の wire 契約と machine document の digest
- publisher 中立な共通モデルの normative 文面
- `$id` が名指す path の [公開 schema](/schemas/) bytes
- conformance の語彙と class、参照 harness の使い方

配信しないもの:

- Form definition と Form ごとの example
- publisher の Form catalog や roster
- Form 固有の conformance report
- client adapter の resource page、およびその availability と status
- Host support、Form activation、商用 offering の状態
- realized な DNS / CDN / account / credential の状態

Form ごとの人間向け page は、その package を公開する publisher が、自分の site へ
deploy し、canonical な repository / tag / sourcePath へ link します。この site は
それを複製せず、publisher の中央 roster も持ちません。

Takoform の client adapter（Terraform / OpenTofu 向け）の入手可否や status は、
Terraform Registry と
[`tako0614/terraform-provider-takoform`](https://github.com/tako0614/terraform-provider-takoform)
を見てください。この site はそれについて何も述べません。

## schema の `$id` について

公開 schema の `$id` は `https://forms.takoform.com/schemas/...` です。これは仕様上の
論理 identity であり、この site は `$id` の path と同じ path で同じ bytes を配信します。
その hostname を実際にこの site へ向けるかどうかは operator の判断です。

identity の append-only な正本は
[`release/public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json)
です。占有された `$id` の bytes が変わることはありません。撤回は retired 記録へ移り、
bytes と理由を保ったまま残り、別の contract に再利用されません。

## 以前の site

`takoform.com` は以前、別の repository から build された site が配信していました。その
site は superseded です。API と共通モデルの page はこの repository が所有し、Form catalog
page は publisher が所有します。運用手順は source repository の
[`docs/site.md`](https://github.com/tako0614/takoform/blob/main/docs/site.md) にあります。
