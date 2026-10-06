---
# Generated from spec/host-api/v2/examples.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/host-api/v2/examples.md
sourceLanguage: ja-JP
releaseState: published
---

<div lang="ja-JP" class="specification-source">

# v2の要求と応答を読む

この文書は[HTTP API](/spec/host-api/v2/http)の使い方を、要求と応答の往復で示す非規範の解説です。
実サーバーで実行した記録ではありません。`host.example` と `forms.publisher.example` は
説明用の名前で、[KeyValueEntry](/spec/host-api/v2/forms)も架空のFormです。

## 一つ作り、読み、更新して削除する

### この例で使う値

主手順のHostにはSpace `default` があり、Offering、事前確認、秘密入力には対応していないものとします。利用者はHostの案内に従って認証情報を得ています。読みやすさのためHTTP例では認証ヘッダーを省略していますが、認証不要という意味ではありません。

Form URLと `spec` は、Formの仕様を読んだ利用者が決めます。SpaceとResource名も利用者が選びますが、Spaceを使う権限はHostが別途確認します。APIの接続先と上限はDiscoveryから読みます。`Idempotency-Key` はクライアントが操作ごとに新しく生成し、同じ要求を再送するときだけ同じ値を使います。Resource UID、Operation ID、時刻、`Location` はHostが返す値です。以下の識別子と時刻はすべて説明用です。

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
```

ここでは `baseUrl` をAPIの接続先として使います。表示した上限と24時間の再送期間はこの架空Hostの値であり、共通の固定値ではありません。

### Formへの対応を確認する

`support` はHostの対応状況を返します。Formの仕様本文を取得する機能ではありません。利用者はForm URLで仕様を確認し、操作ごとにそのURLをHostから取得する必要はありません。

```http
GET /apis/forms.takoform.com/v2/support?form=https%3A%2F%2Fforms.publisher.example%2Fkey-value-entry%2F1.0.0 HTTP/1.1
Host: host.example

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

この応答は、このHostが当該Formの四つの操作に対応すると宣言している例です。利用枠の予約や利用許可を意味しません。

### 作成する

次の要求では、利用者が選んだSpaceと名前、Form仕様に従った `spec` を送ります。Offeringを使わないHostなので `offering` は含めません。作成・更新・削除それぞれで異なる再送キーを使います。

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
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

`202 Accepted` は要求が受理され、Operationがまだ完了していないことを示します。本文の `id` と `Location` の末尾にあるOperation IDは同じです。`Location` を使うか、本文のIDから同じURLを組み立てて進行状況を取得します。

### 完了とResourceを確認する

次の応答は、作成Operationが完了した後に取得した例です。`succeeded` と `effect: complete` は、このFormが定めた管理操作の完了を示します。アプリケーションや外部接続先の稼働を別に測っていない限り、それらの稼働保証ではありません。

```http
GET /apis/forms.takoform.com/v2/operations/op_create_1 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_create_1", "resourceUid": "r_1", "action": "create", "generation": 1,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:00:00Z", "updatedAt": "2026-10-04T12:00:01Z",
  "retainUntil": "2026-10-05T12:00:01Z"
}
```

Operationの `resourceUid` からResourceを読みます。`generation` と `observedGeneration` がともに1なので、この例では作成した世代をHostが観測済みです。`observedAt` はその観測時刻で、GETを行った時刻とは限りません。

```http
GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "generation": 1, "observedGeneration": 1, "observedAt": "2026-10-04T12:00:01Z", "phase": "idle",
  "spec": { "key": "greeting", "value": "hello" },
  "observed": { "entryExists": true, "key": "greeting", "value": "hello" },
  "output": {}, "lastOperation": "op_create_1"
}
```

`spec` はHostが受け付けた希望値、`observed` は最後に確認した状態です。このFormの `output` は空です。`phase: idle` は実行中の操作がない状態であり、アプリケーションの利用可能状態を表すものではありません。

### 値を更新する

更新には、直前に読んだ `generation` と一致する世代条件を付けます。Formの `spec` は全体置換なので、`value` だけを変える場合も変更後の `spec` 全体を送り、変更しない `key` も含めます。ここでは別操作のため、新しい `Idempotency-Key` を使います。

```http
PUT /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Content-Type: application/json
Idempotency-Key: 3908a7cc-5083-439f-9966-b3db7e405859
Takoform-Expected-Generation: 1

{ "spec": { "key": "greeting", "value": "こんにちは" } }

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

応答が受理を示すだけなら、`Location` からOperationを取得して完了を待ちます。

```http
GET /apis/forms.takoform.com/v2/operations/op_update_1 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_update_1", "resourceUid": "r_1", "action": "update", "generation": 2,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:01:00Z", "updatedAt": "2026-10-04T12:01:01Z",
  "retainUntil": "2026-10-05T12:01:01Z"
}
```

Operationの成功後にResourceを再取得し、希望値と観測値を確認します。世代が2へ進み、観測も第2世代に追いついた例です。

```http
GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "generation": 2, "observedGeneration": 2, "observedAt": "2026-10-04T12:01:01Z", "phase": "idle",
  "spec": { "key": "greeting", "value": "こんにちは" },
  "observed": { "entryExists": true, "key": "greeting", "value": "こんにちは" },
  "output": {}, "lastOperation": "op_update_1"
}
```

### Resourceを一覧する

Resource一覧は任意機能ではなく、必須のAPIです。この主手順のHostはOfferingを使わないため、返るResourceに `offering` はありません。

```http
GET /apis/forms.takoform.com/v2/resources?space=default HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "items": [
    {
      "uid": "r_1", "form": "https://forms.publisher.example/key-value-entry/1.0.0",
      "space": "default", "name": "greeting",
      "generation": 2, "observedGeneration": 2, "observedAt": "2026-10-04T12:01:01Z", "phase": "idle",
      "spec": { "key": "greeting", "value": "こんにちは" },
      "observed": { "entryExists": true, "key": "greeting", "value": "こんにちは" },
      "output": {}, "lastOperation": "op_update_1"
    }
  ],
  "nextCursor": null
}
```

`nextCursor: null` はこの例で後続ページがないことを示します。カーソルが返った場合の続き方や絞り込み条件は[ページ形式](/spec/host-api/v2/http#pagination)に従います。

### 削除する

削除では、現在の世代（ここでは2）を指定し、削除操作専用の新しい再送キーを使います。

```http
DELETE /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
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

受理後はResourceが削除中になり、完了まで名前も占有されたままです。Operationの成功を確認してからResourceの状態を確かめます。

```http
GET /apis/forms.takoform.com/v2/operations/op_delete_1 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_delete_1", "resourceUid": "r_1", "action": "delete", "generation": 3,
  "status": "succeeded", "effect": "complete",
  "createdAt": "2026-10-04T12:02:00Z", "updatedAt": "2026-10-04T12:02:01Z",
  "retainUntil": "2026-10-05T12:02:01Z"
}
```

この例のHostは削除済みResourceを410で示します。Hostは404を返すこともできます。Resourceを再取得できないことと、削除Operationが成功したことは別々に確認しています。

```http
GET /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example

HTTP/1.1 410 Gone
Content-Type: application/problem+json
Cache-Control: no-store

{
  "type": "about:blank", "title": "Gone", "status": 410,
  "code": "gone", "detail": "This resource has been deleted."
}
```

削除後もOperationは `retainUntil` まで取得できます。同じ名前で別Resourceを作れば新しいUIDになり、以前のUIDを指定した更新や削除が新Resourceへ及ぶことはありません。

## 応答を失った場合

作成要求を送ったものの `202` 応答が届かなかった場合、Discoveryに示された再送期間内なら、元と同じキー、URL、本文で再送します。Hostは元のOperationを返します。完了済みなら `200`、未完了なら `202` となり、どちらもUIDは `r_1` のままです。Hostが再起動していても同じ永続記録から結果を返します。

同じキーで本文の `value` だけを変えて再送すると `409 idempotency_conflict` です。再送期間を過ぎた後は、再送で安全に回復できるとは限りません。たとえば `GET {root}/resources?space=default&name=greeting` でResourceを探し、保持されていればそのOperationと照合します。見つからないだけで「未作成」とは判断せず、記録の保持切れや不明な副作用を考慮します。

世代条件が古い場合も、Hostは更新を拒否します。クライアントはResourceを読み直して変更内容を確認し、新しい世代を前提に利用者の意図を確かめます。世代を自動で付け替えて上書きしてはいけません。

## 任意機能の例

以下は主手順とは別々の架空Hostを使った例です。Offeringの例ではOfferingだけ、事前確認の例ではpreviewだけ、秘密入力の例ではprivateInputsだけを有効にします。利用するHostが対応する機能は、それぞれDiscoveryで確認します。

### Offeringの一覧と選択

この例のHostは `capabilities.offerings:true`、`previews:false`、`privateInputs:false` です。Offeringを必須とするHostでは、FormとSpaceに対する候補を取得し、利用者が一つを選びます。revisionはHostが返した値をそのまま作成要求に含めます。条件が変わってrevisionが一致しない場合、Hostは別のOfferingを黙って選ばず `409 offering_changed` を返します。

```http
GET /apis/forms.takoform.com/v2/offerings?form=https%3A%2F%2Fforms.publisher.example%2Fkey-value-entry%2F1.0.0&space=default HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "items": [
    {
      "id": "standard", "revision": "rev-7",
      "form": "https://forms.publisher.example/key-value-entry/1.0.0",
      "label": "Standard", "description": "Standard capacity",
      "termsUrl": "https://host.example/terms/standard"
    }
  ],
  "nextCursor": null
}
```

候補を選んだ作成要求には、応答にあった `id` と `revision` を組にして指定します。Offering一覧にない値を推測して作成しません。

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Content-Type: application/json
Idempotency-Key: 2b908375-c0f2-4f9e-8cf5-0522bf8a45ad

{
  "form": "https://forms.publisher.example/key-value-entry/1.0.0",
  "space": "default", "name": "greeting",
  "offering": { "id": "standard", "revision": "rev-7" },
  "spec": { "key": "greeting", "value": "hello" }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_create_2
Retry-After: 1

{
  "id": "op_create_2", "resourceUid": "r_2", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T13:00:00Z", "updatedAt": "2026-10-04T13:00:00Z",
  "retainUntil": "2026-10-05T13:00:00Z"
}
```

### 事前確認

この例のHostは `capabilities.offerings:false`、`previews:true`、`privateInputs:false` です。事前確認に対応するHostでは、実行予定の入力を検証できます。この結果は助言であり、Resource作成、予約、Operationを発生させません。実際に作成するときもHostは改めて検査します。

```http
POST /apis/forms.takoform.com/v2/previews HTTP/1.1
Host: host.example
Content-Type: application/json

{
  "action": "create",
  "input": {
    "form": "https://forms.publisher.example/key-value-entry/1.0.0",
    "space": "default", "name": "preview-greeting",
    "spec": { "key": "preview-greeting", "value": "hello" }
  }
}

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{ "valid": true, "errors": [] }
```

### 秘密入力の補給

この例のHostは `capabilities.offerings:false`、`previews:false`、`privateInputs:true` です。また、Formの対応応答も `privateInputs:true` を示す場合に限り、秘密入力を送れます。次は、別のFormが `apiToken` という秘密入力を定義した場合の例です。最初の要求には、そのFormが要求した秘密入力マップ全体を含めます。以下の `<秘密値>` は説明用の置換文字列であり、実際の認証情報ではありません。実利用では秘密管理手段から値を渡し、文書や公開stateへ保存しません。

```http
GET /apis/forms.takoform.com/v2/support?form=https%3A%2F%2Fforms.publisher.example%2Fsecret-service%2F1.0.0 HTTP/1.1
Host: host.example

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "form": "https://forms.publisher.example/secret-service/1.0.0",
  "supported": true,
  "operations": ["create", "read", "update", "delete"],
  "privateInputs": true
}
```

```http
POST /apis/forms.takoform.com/v2/resources HTTP/1.1
Host: host.example
Content-Type: application/json
Idempotency-Key: 8e74a095-74b6-46bf-9e58-921ab0c74d6c

{
  "form": "https://forms.publisher.example/secret-service/1.0.0",
  "space": "default", "name": "private-service",
  "spec": { "endpoint": "https://service.example" },
  "privateInputs": { "apiToken": "<秘密値>" }
}

HTTP/1.1 202 Accepted
Content-Type: application/json
Cache-Control: no-store
Location: https://host.example/apis/forms.takoform.com/v2/operations/op_secret_1
Retry-After: 1

{
  "id": "op_secret_1", "resourceUid": "r_secret_1", "action": "create", "generation": 1,
  "status": "waiting_input", "effect": "none",
  "createdAt": "2026-10-04T14:00:00Z", "updatedAt": "2026-10-04T14:01:00Z",
  "retainUntil": "2026-10-05T14:01:00Z",
  "inputRequired": { "names": ["apiToken"], "reason": "expired" }
}
```

`waiting_input` は、この例ではHostが秘密を実行先へまだ送っておらず、入力の補給を待つ状態です。補給では**最初の要求と同じ秘密入力マップ全体**を送り、値を変更・追加・削除しません。下記のプレースホルダーは、最初の要求に使った値と同一のものを表します。

```http
PUT /apis/forms.takoform.com/v2/operations/op_secret_1/private-inputs HTTP/1.1
Host: host.example
Content-Type: application/json

{ "privateInputs": { "apiToken": "<秘密値>" } }

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "id": "op_secret_1", "resourceUid": "r_secret_1", "action": "create", "generation": 1,
  "status": "queued", "effect": "none",
  "createdAt": "2026-10-04T14:00:00Z", "updatedAt": "2026-10-04T14:02:00Z",
  "retainUntil": "2026-10-05T14:02:00Z"
}
```

補給は既存Operationを続ける操作なので、新しい再送キーや世代は使いません。同じ値を繰り返し送っても、新しい実行を始めません。実行先へ送信済みか不明な場合は入力待ちにせず、Hostは照合を続けます。


</div>
