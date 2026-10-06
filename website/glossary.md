---
title: 用語集
description: Host API v2の主要語を、FormとHostの責任分担に沿って説明します。
---

# 用語集 {#glossary}

## Form {#form}

作者が公開する版固定URLの仕様。Resourceの意味と操作の条件を定めます。Hostや実行環境そのものではありません。

## Host {#host}

Formを実装し、認証されたクライアントへResource APIを提供するサービス。特定Formのサポート状況はHostごとに異なります。

## Resource {#resource}

Hostが管理する対象。UID、Form URL、Space、name、generation、`spec`、`observed`、`output`などを持ちます。

## spec {#spec}

Resourceの受理済み希望状態。Updateでは文書全体を置き換えます。

## observed {#observed}

Hostが最後に確認した状態。specの希望世代に追いついていない場合があります。

## output {#output}

Formが意味を定める操作結果や接続情報。空である場合もあります。

## generation / observedGeneration {#generation-observedgeneration}

generationは受理された希望状態の世代です。observedGenerationはobservedが反映する世代を示します。

## Operation {#operation}

Create、Update、Deleteの進行と結果を表す記録。クライアントはOperationを読み、必要に応じてResourceの状態を再取得します。

## Idempotency-Key {#idempotency-key}

同じ要求の再送を識別するクライアント指定キー。同じキーを使う再送では、元の要求内容も同じでなければなりません。

## Space {#space}

Host内のResourceスコープ。Spaceを指定すること自体は、そのSpaceを使う権限を与えません。

## v1専用語 {#v1-terms}

FormRef、Form Package、Snapshot、revision、schemaDigestは凍結されたv1契約の語彙です。v2のForm URLやResource generationと同一視せず、詳細は[凍結v1仕様](/spec/host-api/v1)で確認してください。
