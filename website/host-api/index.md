---
title: Implementing Host API v2
description: Resource、Operation、再送記録を再起動後も保つための実装上の責任を説明します。
---

# Implementing Host API v2 {#host-api}

Host API v2のHostは、HTTP応答を返すだけでなく、受理した操作、Resourceの世代、実行先で確認した状態を管理します。ここでは再起動後も保つべき記録と回復方法を説明します。path、status、保持期間の正確な契約は[HTTP API](/spec/host-api/v2/http)を参照してください。

## 受理の記録を一体として永続化する {#acceptance}

変更要求を実行先へ送る前に、Hostは認証・認可、Formの対応状況、入力、参照、世代条件などの拒否条件を確認します。受理する場合は、Resource、Operation、Idempotency-Keyと要求内容の対応を一体として永続化します。別々の書込みが部分成功して「OperationはあるがResourceがない」「実行先は変わったが再送記録がない」とならないよう、同じ再送キーを持つ要求や同一Resourceへの競合する変更要求は、一つだけを受理します。

再起動後に元要求を識別できるよう、受理記録には少なくとも以下を残します。

- `principal`（認証主体）の識別情報、APIの版、Idempotency-Key、および要求一致の判定に必要なHTTP method、pathとquery、世代条件、JSON値。
- Hostが発行したResource UID、Form URL、Space、name、受理済みの`spec`、現在の`generation`。
- Operation ID、action、statusと`effect`、受理した`generation`、受理時刻、保持期限。
- 次の処理を元のOperationへ結び付ける実行状態と、結果を確認するための実行先識別子。

キーの適用範囲は`(Host, API version, stable principal, key)`です。同じkeyと同じ要求には元のOperationを返し、別の要求にkeyを流用した場合は競合として拒否します。未完了のOperationや結果不明の`effect`は、期限切れとして捨ててはいけません。共通仕様はデータベース、メッセージキュー、ORM、暗号化方式を指定しません。必要なのは、上記の対応を保つ永続化と同時実行制御です。

## 実行と記録を同じOperationに結ぶ {#dispatch}

HTTP要求の処理と実行先の作業は、別の期間にわたって進むことがあります。バックグラウンド処理へ渡す場合は、受理済みOperationを復元できる永続化した処理通知、または同等の再開手段を用意します。処理通知が重複して届いたり、Hostが再起動したりしても、新しいUID、Operation、実行先の資源を作らず、元のOperationを続けます。実行結果が不明な間は、同じUIDへの別の変更要求を`resource_busy`で拒否します。

`GET /operations/{id}`は現在の記録を返す読み取りです。GETを受けたことをきっかけにCreate/Update/Deleteを再送したり、復旧処理を開始したりしません。通常の進行はバックグラウンド処理が担い、ResourceのGETは最後に確認できた`observed`、`observedGeneration`、`observedAt`を返します。GET時に実行先を読み直す場合でも、副作用を起こす処理を始めたり、未確認の値を観測済みとして扱ったりしません。

## 再起動や応答喪失の位置ごとに回復する {#recovery}

| 障害位置 | 永続状態と次の処理 |
| --- | --- |
| 受理記録より前 | Operationも実行先への変更も受理されていません。入力を検証し直し、受理する場合は一度だけ永続化します。同じkeyの要求が同時に届いても、その記録へ結び付きます。 |
| 受理記録後、実行先へ送る前 | `queued/effect:none`と元Operationの処理情報を復元し、そのOperationを進めます。UIDやkeyを作り直しません。 |
| 実行先へ送った後、結果を記録する前 | 実行されなかったと決めつけず、`reconciling/effect:unknown`にします。保存済みの実行先識別子を使って結果を確認し、確定するまで新しい変更要求を止めます。timeoutだけで`failed/effect:none`にはできません。 |
| 実行先で成功した後、完了状態を記録する前 | 実行先の状態を照合し、確認できたら元Operationを完了状態へ進めます。成功した処理を二重実行する新Operationを作りません。 |

クライアントへの受理応答だけが失われ、Hostの受理記録が残っている場合は、同じkeyと同じ要求を再送すると、元のOperationの現在状態が返ります。認可がなくなった場合、Hostはその状態を隠して`403`または`404`を返せます。

## 成功と観測を分ける {#observation}

OperationはFormが定めた一つの管理操作の進行状況と実行結果を示します。`succeeded/effect:complete`はその操作が完了したことを表しますが、一般的なサービスの稼働状況を示すものではありません。Resourceの`spec`には受理済みの希望状態を保持し、`observed`は実行先で最後に確認した値だけで更新します。失敗後もResourceと部分的に生じた変更との対応を残し、Formが定める同じUIDへのUpdate/Deleteによる復旧を受け付けられるようにします。

この境界を満たしたうえで、バックグラウンド処理、データベース、メッセージキューをどう組み合わせるかはHostの実装に委ねられます。規範仕様で定めるstatus、保存期間、`404`/`410`、問題形式は[HTTP API仕様](/spec/host-api/v2/http)に従ってください。
