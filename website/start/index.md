---
title: v2を使い始める
description: 架空のKeyValueEntryを例に、DiscoveryからResourceの削除確認までを一続きでたどります。
---

# v2を使い始める {#start}

Host API v2では、FormがResourceの意味を定義し、Hostが対応するFormを実装し、クライアントがResourceを管理します。下の一連のHTTP例は架空のHost `host.example` とForm URL `https://forms.publisher.example/key-value-entry/1.0.0` を使った説明です。接続可能なサービスや実在する公開Formを示すものではありません。完全な要求・応答の記録と失敗時の分岐は[要求・応答例](/spec/host-api/v2/examples)にあります。

## 1. Hostを見つけ、Formへの対応を調べる {#discover-support}

Formは作者が公開する版固定URLの仕様で、Hostはその仕様を実装するサービスです。Form URLが存在するだけではHostで実行できません。まずHostのoriginから接続先と認証方式を取得し、そのHostへ正確なForm URLを問い合わせます。

```http
GET /.well-known/takoform/v2 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json

{
  "api": "forms.takoform.com/v2",
  "baseUrl": "https://host.example/apis/forms.takoform.com/v2",
  "documentation": "https://host.example/docs",
  "authentication": {
    "schemes": ["Bearer"],
    "documentation": "https://host.example/docs/auth"
  },
  "capabilities": { "offerings": false, "previews": false, "privateInputs": false },
  "limits": { "maxRequestBytes": 1048576, "maxPageSize": 100, "replayWindowSeconds": 86400 }
}

GET /apis/forms.takoform.com/v2/support?form=https%3A%2F%2Fforms.publisher.example%2Fkey-value-entry%2F1.0.0 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "supported": true,
  "operations": ["create", "read", "update", "delete"],
  "privateInputs": false
}
```

Discoveryの`baseUrl`をAPI接続先にし、認証案内に従います。`support`はこのHostの技術的な対応を示します。利用権限や容量を予約する応答ではありません。

## 2. Createを受理し、OperationとResourceを読む {#create-read}

クライアントが選ぶのはForm URL、利用権限のあるSpace、name、Formに沿った`spec`、そして新しい操作ごとのIdempotency-Keyです。UIDとOperation IDはHostが発行します。

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 946eec36-4a6a-41de-8f3c-e83d2c58c246

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default",
  "name": "greeting",
  "spec": { "key": "greeting", "value": "hello" }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_create_1
Retry-After: 1

{
  "id": "op_create_1", "resourceUid": "r_1", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:00:00Z", "updatedAt": "2026-10-04T12:00:00Z",
  "retainUntil": "2026-10-05T12:00:00Z"
}
```

`202 Accepted`は「受理済み、未完了」です。`Retry-After`の後に`Location`または`op_create_1`からOperationを取得し、成功を確認してからResourceを読みます。

```http
GET /apis/forms.takoform.com/v2/operations/op_create_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_create_1", "resourceUid": "r_1", "action": "create", "generation": 1,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:00:00Z", "updatedAt": "2026-10-04T12:00:01Z",
  "retainUntil": "2026-10-05T12:00:01Z"
}

GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "generation": 1, "observedGeneration": 1,
  "observedAt": "2026-10-04T12:00:01Z", "phase": "idle",
  "spec": { "key": "greeting", "value": "hello" },
  "observed": { "entryExists": true, "key": "greeting", "value": "hello" },
  "output": {}, "lastOperation": "op_create_1"
}
```

`spec`は受理された希望値、`observed`はHostが最後に確認した状態です。`generation`と`observedGeneration`が同じなら、この例ではその世代が観測済みです。Operation成功や`phase: idle`だけで、アプリケーションの稼働までは判断できません。

## 3. 世代を条件に全specを更新する {#update}

更新は差分patchではなく、新しい`spec`文書全体を送ります。読み取った世代を条件にし、別の操作なので新しいキーを使います。

```http
PUT /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Content-Type: application/json
Idempotency-Key: 3908a7cc-5083-439f-9966-b3db7e405859
Takoform-Expected-Generation: 1

{ "spec": { "key": "greeting", "value": "welcome" } }

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_update_1
Retry-After: 1

{
  "id": "op_update_1", "resourceUid": "r_1", "action": "update", "generation": 2,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:01:00Z", "updatedAt": "2026-10-04T12:01:00Z",
  "retainUntil": "2026-10-05T12:01:00Z"
}
```

Operation `op_update_1`が完了状態になるまで確認し、Resource `r_1`を再取得します。更新が完了した例では`generation`と`observedGeneration`がともに2、`spec.value`と観測した`observed.value`が`welcome`です。最新世代が1でなければ、この古い要求を新世代へ付け替えず、Resourceを読み直して変更意図を組み立て直します。

## 4. 世代2を条件に削除する {#delete}

Resourceの最新generationを確認した後、その値でDeleteを要求します。削除もOperationで追跡します。

```http
DELETE /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Authorization: Bearer <host-credential>
Idempotency-Key: e1a20f10-0ac6-491d-b665-04de19f965f4
Takoform-Expected-Generation: 2

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_delete_1
Retry-After: 1

{
  "id": "op_delete_1", "resourceUid": "r_1", "action": "delete", "generation": 3,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T12:02:00Z", "updatedAt": "2026-10-04T12:02:00Z",
  "retainUntil": "2026-10-05T12:02:00Z"
}
```

`op_delete_1`を読み、成功を確認します。その後のResourceのGETは、Hostが削除記録を保持する場合は`410 Gone`、保持しない場合は`404 Not Found`になり得ます。削除結果の根拠にはOperationを使い、404/410だけから実行先への効果を推測しません。要求・応答の全項目と失敗時の復旧経路は[HTTP API](/spec/host-api/v2/http)と[完全な例](/spec/host-api/v2/examples)を参照してください。

## Host実装者が持つべき耐久性 {#host-implementers}

受理済みOperation、Idempotency-Keyとの対応、Resource UIDとgeneration、最後に確認したobserved状態を、プロセス再起動後も追跡できる必要があります。HTTP処理が終わった後にworkerが進行する場合も、未処理・実行中・結果不明を区別して再開します。詳細は[Host実装ガイド](/host-api/)を参照してください。
