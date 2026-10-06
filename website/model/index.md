---
title: v2のモデル
description: Form、Host、Resource、Operation、世代がどの責任を表すかを説明します。
---

# v2のモデル {#model}

v2では、仕様を定義するForm、仕様を実行するHost、Hostが管理するResource、変更の進行を示すOperationを区別します。この分離により、Formの意味と、あるHostが実際に提供する機能を混同せずに扱えます。

## FormとHost {#form-host}

Formは作者が公開する版固定のHTTPS URLで識別される仕様です。Resourceの`spec`、`observed`、`output`の意味や操作の条件を定義します。Form自体はAPIサーバーや実行環境ではありません。

HostはFormを実装し、認証されたクライアントにResource操作を提供します。HostのDiscoveryは接続先や機能を示し、`support`は正確なForm URLへの対応状況を示します。Formの公開、Hostの対応、利用者の権限はそれぞれ別の事実です。

## Resourceの希望状態と観測状態 {#resource-state}

ResourceはHost内で一意なUIDを持ち、Form URL、Space、名前、世代と状態を持ちます。UIDは削除後に再利用されません。

- `spec`: クライアントが望み、Hostが受け付けた状態。Update要求では`spec`文書全体を置き換えます。Resourceの識別情報や他の状態を置き換える意味ではありません。
- `observed`: Hostが最後に観測した状態。希望値に追いついていないことがあります。
- `output`: Formが定義する操作結果や接続情報。空であることもあります。
- `generation`: 受理された希望状態の世代。Create後に始まり、Update/Delete受理で進みます。
- `observedGeneration`: `observed`がどの世代を反映するかを示します。
- `observedAt`: Hostが観測結果を記録した時刻です。GET要求時刻とは限りません。

したがって、Operationが成功したこと、Hostがあるgenerationを観測したこと、利用者のアプリケーションが稼働していることは同義ではありません。利用可能性はFormとHostが明示する別の観測情報で判断します。

## Operationと再送 {#operations-retry}

Create、Update、DeleteはOperationを生成します。HostはOperation ID、対象Resource、action、generation、状態、結果を返します。ClientはOperationを読み、必要に応じてResourceを再取得します。GETは読み取りであり、処理を開始しません。

Clientが同じ操作を再送する場合は、同じIdempotency-Keyと同じ要求内容を使います。新しい操作には新しいキーを使います。再送範囲・保持時間はHostのDiscoveryにある値を確認します。キーの保持期限後に再送を重複防止できるとは限りません。

## 世代条件と競合 {#generation-conflicts}

Update/Delete要求には読み取ったgenerationを`Takoform-Expected-Generation`として指定します。世代が変わっていればHostは古い意図を暗黙に再適用せず、競合として扱います。Clientは最新Resourceを読み、どの変更を続けるかを決め直します。

## v1との語彙の違い {#v1-terms}

FormRef、Form Package、Snapshot、schemaDigestはv1の契約に属する語彙です。v2のForm URLやResource状態と同じものとして置き換えてはいけません。v1を調べる場合は[凍結されたv1仕様](/spec/host-api/v1)を参照してください。v2の規範は[概要](/spec/host-api/v2/)、[HTTP API](/spec/host-api/v2/http)、[Form要件](/spec/host-api/v2/forms)にあります。
