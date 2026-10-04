---
# Generated from spec/host-api/v2/examples.md by scripts/site.mjs. Edit the specification, not this page.
normative: false
canonicalSource: spec/host-api/v2/examples.md
sourceLanguage: ja-JP
releaseState: unpublished
---

<div lang="ja-JP" class="specification-source">

# v2の要求と応答を読む

この文書は[HTTP API](/spec/host-api/v2/http)の非規範の解説です。
実サーバーの実行結果ではありません。`host.example` と `forms.publisher.example` は
説明用の名前で、[KeyValueEntry](/spec/host-api/v2/forms)も公開済みFormではありません。

## 一つ作って、変更して、削除する

このHostはSpace `default` を持ち、Offeringを使わないとします。
利用者はHostの手順でcredentialを得ており、以下ではAuthorization値を省略しています。
認証不要という意味ではありません。Hostが次の情報を返す例です。

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

この上限と24時間のwindowは例であり、共通の固定値ではありません。
以下は同じHostのAPIです。bodyのないGETやDELETEにはContent-Typeを付ける必要はありません。

### 対応を確認する

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

これはHostの対応状況です。Formの定義そのものをHostから取得しているのではありません。
利用者は仕様の意味を作者のURLで確認します。操作のたびにそのURLを取得する必要はありません。

### 作成する

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

### 結果と資源を取得する

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

### 値を更新する

```http
PUT /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Content-Type: application/json
Idempotency-Key: 3908a7cc-5083-439f-9966-b3db7e405859
Takoform-Expected-Generation: 1

{ "spec": { "key": "greeting", "value": "こんにちは" } }
```

受理した応答はcreateと同じOperation形式で、`id:op_update_1`、`action:update`、
`resourceUid:r_1`、`generation:2` です。完了を取得してからResourceを読むと、
generationとobservedGenerationが2、specとobservedのvalueが「こんにちは」になります。

途中で別の利用者が更新していれば、古い世代の変更は拒否されます。

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
Cache-Control: no-store

{
  "type": "about:blank", "title": "Conflict", "status": 409,
  "code": "generation_conflict",
  "detail": "Read the resource and review the newer generation before updating."
}
```

クライアントは資源を取得し、変更内容を確認します。自動で現在世代へ付け替えて上書きしません。

### 削除する

```http
DELETE /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1
Host: host.example
Idempotency-Key: e1a20f10-0ac6-491d-b665-04de19f965f4
Takoform-Expected-Generation: 2
```

応答は `action:delete`、`generation:3` のOperation。完了までResourceはdeletingです。
succeededになった後、GET Resourceは404または410、一覧にr_1はありません。
同じ名前を再び使ってもUIDは変わります。元のDELETEは新しい資源を対象にしません。

## 応答を失ったら

作成の202応答が届かなかったとします。クライアントは最初の送信からwindow内で、
**同じキー、同じURL、同じbody** を再送します。Hostはop_create_1を返します。
完了済みなら200、未完了なら202であり、UIDはどちらもr_1です。
間にHostのプロセスが再起動していても、同じ永続記録からこの結果を返します。

同じキーでvalueだけを変えた場合は `409 idempotency_conflict` です。
windowを過ぎた場合、再送で安全に回復できるとは限りません。
`GET /resources?space=default&name=greeting` で元資源を探し、そのOperationを照合します。
見つからないだけで「未作成」と判断せず、操作記録の保持切れや不明な副作用を確認します。

## 秘密入力が必要なFormの場合

KeyValueEntryに秘密はありません。以下は別のFormが `apiToken` という秘密入力を定義した
場合だけの補足です。秘密入力を定義したFormと対応Hostを選んだ後に、元の要求へ
`privateInputs: { "apiToken": "..." }` を含めます。実credentialを文書や公開stateへ保存しません。

Hostがまだ送信していない工程で一時保存の値を失った場合、Operationは次の状態になり得ます。
これは説明用の抜粋で、実応答には§5の他の必須fieldも含まれます。

```json
{
  "status": "waiting_input",
  "effect": "none",
  "inputRequired": { "names": ["apiToken"], "reason": "expired" }
}
```

クライアントは同じ秘密mapを `PUT /operations/{id}/private-inputs` へ補給します。
Hostは元要求と照合し、同じOperationだけを継続します。補給の応答が失われても、同じPUTで
別の実行を開始しません。違う秘密値は409です。元の照合材料まで失われていれば、
Hostは推定せず `private_inputs_unverifiable` を返します。

送信済みか不明ならwaiting_inputではなくreconcilingです。秘密を再送させて新規資源を
作り直す方法で隠しません。確認できた部分失敗は元Resourceをerrorに残し、
新しい明示的更新・削除でそのUIDを復旧します。

## 実装の受け入れケース

下記は要求と期待値の一覧であり、実行済みのテスト件数ではありません。

| ケース | 期待する結果 |
| --- | --- |
| 作成の同時再送 | 一つのOperationとUIDだけが受理される |
| 同じキーで別body・別UID | 409。新しい副作用なし |
| 更新の応答喪失後、元generationで再送 | generation不一致より先に元Operationを返す |
| 別principalが同じキーを送る | 元利用者の情報を返さない |
| 外部作成の直後にHostを終了 | 同じ永続記録と外部identityから再開・照合。別名で再作成しない |
| 外部応答の成否が不明 | reconciling/unknown。単発404やtimeoutで失敗確定にしない |
| 一部だけ作成して既知の失敗 | Resourceをerrorとして追跡。PUT/DELETEで復旧・後始末できる |
| 同名の削除・再作成 | 新UIDになる。旧UIDへの更新やDELETEが新資源に及ばない |
| publisherサイト停止 | 実装済みの契約で既存資源を操作できる |
| Offering条件の更新 | 古いrevisionによる作成は拒否。別条件を勝手に選ばない |
| 秘密入力の期限切れ | 未送信の工程だけ入力待ち。値はResource/Operation/logへ出ない |
| preview成功の後に依存先が削除 | 実操作で再検査。previewを実行許可とみなさない |

公開後の適合確認では、これらにForm固有の入力・接続・ready・削除のケースを加えます。
ローカルのmock成功と、実Hostでのプロセス再起動・実行先の復旧を同じ証拠として扱いません。


</div>
