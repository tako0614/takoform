---
title: Guides
---

# Guides

このページは non-normative な案内です。どの reader が何を先に読むかだけを示し、
contract の意味は [Reference](/reference/) にある英語の source に委ねます。

## architect

境界と責任を先に決めたい reader 向けです。

1. [共通モデル](/model/) で FormRef、Form Package、Snapshot の関係を見る。
2. [Portable Form boundary](/spec/portability-boundary) で、Form に入る意味と Host や
   operator に残る事実を分ける。
3. [Versioning and compatibility](/spec/versioning) で、4つの named stream と2つの
   domain version axis の違いを確認する。

ここでの結論は、portable な contract は service の意味を表し、account、credential、
placement、price、backend の選択を表さない、ということです。

## Core / artifact user

package を受け取り、検証して、Snapshot を使う reader 向けです。

1. [Start](/start/) の二つの command を実行する。
2. [Data-only Form Package](/spec/form-package/) で index、canonical digest、payload
   closure を確認する。
3. [Immutable Snapshot](/spec/core/) で exact reference closure、defaults、順序非依存の
   compile、失敗時の no-partial-result を読む。
4. 必要なら [`formpackage`](https://github.com/tako0614/takoform/tree/main/formpackage)、
   [`snapshot`](https://github.com/tako0614/takoform/tree/main/snapshot)、
   [`trust`](https://github.com/tako0614/takoform/tree/main/trust) の package API へ進む。

command の report は data と compiler の性質を示します。Host が resource を実行した
証拠や、publisher の公開判断までは含みません。

## Host / client implementer

wire と adapter の境界を実装する reader 向けです。

1. [Host API v1 とは](/host-api/) で discovery、API root、lifecycle root の関係を見る。
2. [Host API v1 wire contract](/spec/host-api/v1) で route、exact FormRef、fence、
   Operation、error の詳細を読む。
3. [Interface contract](/spec/interface-contract/)、[Binding contract](/spec/binding-contract/)、
   [Artifact transport](/spec/artifact-transport/) を必要な順に読む。
4. standard service の protocol を扱うときは [Standard services](/spec/standard-services/)
   の sealed slot と Host-specific support を確認する。

client の local schema、state、import、codec、migration は client 側の責任です。Host の
backend、credential、tenant policy、activation は Host 側の責任で、ここからは導けません。

## verifier / reviewer

「何を検証した report なのか」を確認したい reader 向けです。

1. [conformance と参照実装](/conformance/) で claim の scope を確認する。
2. [Conformance language and classes](/spec/conformance) で requirement keyword と
   independent claim の分類を読む。
3. [Publisher trust and revocation](/spec/trust/) で caller-supplied policy、署名、
   revocation の入力を確認する。
4. [Reference](/reference/) で、その page が English / normative source の mirror か、
   Japanese / non-normative guide かを確認する。

一つの report から publication、Host support、activation、commercial Offering を推測しません。

## OpenTofu / Provider を使う reader

OpenTofu / Provider の command、schema、state、import を調べる場合は、
[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform) を
参照してください。Takoform Core の guide はその project の内容や status を複製しません。

## この site にないもの

この site は個別 Form の definition や実運用の example、publisher catalog、Host の実装・
support/status、client の adapter page を集めません。必要な事実は、それぞれの owner が
公開する source と report から確認してください。
