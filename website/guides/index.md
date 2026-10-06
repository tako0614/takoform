---
title: Guides
description: 利用者、Form作者、クライアント実装者、Host実装者ごとにv2の学習順序を案内します。
---

# Guides {#guides}

目的に合わせてv2の契約を読み進めてください。ここで示す例は説明用であり、共通API仕様は公開Hostや実装の提供状況を表しません。

## 利用者 {#users}

1. [v2を使い始める](/start/)でFormとHostを区別します。
2. 使うHostのDiscovery、認証、Space条件を運営者の案内で確認します。
3. 正確なForm URLの仕様と、そのHostの`support`を確認します。
4. [要求・応答例](/spec/host-api/v2/examples)でCreateからDeleteまでのOperation追跡を読みます。

## Form作者 {#form-authors}

Form URLを版固定で公開し、`spec`、`observed`、`output`、操作の意味、部分失敗の復旧を記述します。[Form要件](/spec/host-api/v2/forms)はv2の規範で、[例](/spec/host-api/v2/examples)はHTTPの利用を示す架空の説明です。

## クライアント実装者 {#client-implementers}

[クライアントガイド](/client/)からDiscovery、support、Idempotency-Key、世代条件、Operationの読み方を確認し、[HTTP API](/spec/host-api/v2/http)を要求・応答の正本として参照します。応答喪失や競合は、盲目的な再送ではなくOperationとResourceの照合で扱います。

## Host実装者 {#host-implementers}

[概要](/spec/host-api/v2/)、[HTTP API](/spec/host-api/v2/http)、[Form要件](/spec/host-api/v2/forms)の順に読みます。認証とSpace認可、Resource UIDとgeneration、Idempotency-Key、Operation記録、観測状態、再起動後の回復までを一つの耐久性境界として設計します。

## v1から移る場合 {#migration}

v2へpackageやSnapshotを持ち込む必要はありません。仕様が自動変換することもありません。旧Resourceやproviderの移行は、それを所有する製品の案内で確認します。[v2移行案内](/spec/host-api/v2/migration)は判断事項を説明し、[凍結されたv1仕様](/spec/host-api/v1)は旧契約を保持します。
