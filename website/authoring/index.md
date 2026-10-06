---
title: Formを作る
---

# Formを作る {#authoring}

Takoform v2のFormは、Hostが管理する一種類のResourceについて、設定と振る舞いを定義する仕様です。まず「このResourceが何を所有するか」を一文で決め、その後に入力、観測、操作、失敗時の回復を具体化します。公開したURLからHostがコードを取得する仕組みではありません。Hostは実装済みのFormだけを明示的にサポートします。

このページでは、架空の `KeyValueEntry` を題材に、一つのFormを設計し、Host API v2で確かめる流れを紹介します。これはチュートリアル用の例で、公開済みのFormやHostサポートを示すものではありません。

## 1. Resourceの目的と境界を決める {#purpose}

例のResourceは「指定したSpaceにある、名前付きの文字列entry一つ」です。entryだけを所有し、collection全体や他のentryは所有しません。HTTPの共通形式は[Host API v2](/spec/host-api/v2/http)、Form固有の規範要件は[Form仕様](/spec/host-api/v2/forms)が定めます。

このFormが使う識別子は、架空の次のURLです。

```text
https://forms.publisher.example/key-value-entry/1.0.0
```

Form URLは文字列の完全一致で識別されます。同じURLの意味を後から変えず、契約の変更には新しいURLを使います。SemVer風のパスは作者が選べる慣習であり、Host APIの版や互換性を自動で決めません。

## 2. 入力と観測を分ける {#definition}

`spec` は利用者が望む状態、`observed` はHostが確認した状態、`output` は利用に必要な値です。三つを混ぜず、未確認を「存在しない」や「ready」と表現しないようにします。

この例の `spec` は次の二項目だけです。未知の項目と `null` は拒否し、暗黙の既定値はありません。

| Field | Meaning | Create | Update |
| --- | --- | --- | --- |
| `key` | 同じHost・Space・Form内で一意なキー。Unicode scalar値1〜128文字。大文字小文字を区別。 | 必須 | 不変 |
| `value` | 保存する文字列。Unicode scalar値0〜4096文字。空文字列も有効。 | 必須 | 置換可能 |

```json
{
  "key": "welcome",
  "value": "Hello, Ada!"
}
```

長さはUTF-8バイト数ではなくUnicode scalar値の数です。Hostがまだentryを確認していなければ `observed: {}`。存在を確認した値は `{ "entryExists": true, "key": "welcome", "value": "Hello, Ada!" }`、不在を確認した値は `{ "entryExists": false }` とします。確認に失敗したときは `entryExists: false` にしません。`output` は常に `{}` で、このFormはアプリケーションの稼働状態を保証しません。

## 3. 操作と失敗後の回復を定義する {#lifecycle}

Formごとにcreate/read/update/deleteの意味を決めます。HTTP status、generation、Idempotency-Key、Operationの形は共通APIの規則を使い、Form仕様で再定義しません。

- **Create:** `(Host, Space, Form URL, key)`の範囲でentryを一つ作成します。同じキーが既に使われていれば `key_conflict` で失敗し、既存値は変更しません。
- **Read:** Resourceと最後に確認した状態を返します。GETごとの再照会は要求しません。
- **Update:** `value`だけ置き換えます。`key`変更は外部効果の前に拒否します。不在entryをupdateで再作成しません。
- **Delete:** 対象entryだけを削除します。既に不在だと確認できれば削除完了です。collectionや別entryは削除しません。

外部書込み後に応答が失われた場合、タイムアウトだけで「未実行」と決めてはいけません。同じResourceと同じOperationのまま、同じキーを読み戻して値を照合します。結果を証明できなければOperationを解決待ちのまま保持します。Formの例を増やす前に、部分成功・失敗・不明結果をどう扱うかを仕様とテストで決めましょう。

## 4. Form仕様とテストを書く {#write}

上の項目表を基に、人が読める規範仕様を作ります。少なくとも以下を一続きで読めるようにします。

1. Resourceの目的と、Formが所有しないもの。
2. 全 `spec` フィールドの型、必須性、省略時の意味、上限、未知フィールドの扱い、変更可能性。
3. `observed`、`output`、未観測・古い観測・readyの意味。
4. create/read/update/deleteの効果、失敗、部分効果、同じUIDでの回復と削除範囲。
5. Resource参照、Interface、Binding、artifactがある場合の正確な識別子、所有者、制約。ない場合は「なし」と明記。
6. private inputを使うなら名前・値・必要条件と、公開Resourceやログへ漏らさない方法。秘密が任意か、全ての有効な利用で必須かを区別。

この例には参照、Interface、Binding、artifact、private inputはありません。機械可読schemaを添える場合も、規範文と同じ入力・更新・エラー意味になるようテストします。完全な要件は[Form仕様 §2](/spec/host-api/v2/forms#what-a-form-specification-must-define)と[作者チェックリスト](/spec/host-api/v2/forms#author-checklist)を参照してください。

## 5. 対応Hostで確認する {#check}

Hostの管理者からAPI root、Space、認証方法を取得してください。以下は環境変数を設定済みとするシェル例です。架空のForm URLなので、実在Hostが対応しているとは限りません。

```sh
export BASE_URL='https://host.example.test/api-root-returned-by-discovery'
export FORM_URL='https://forms.publisher.example/key-value-entry/1.0.0'
export SPACE='development'
export TOKEN='replace-with-a-short-lived-token'

curl --fail-with-body -G "$BASE_URL/support" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "form=$FORM_URL"
```

`support`の `form` が渡したURLと完全一致し、`supported` と必須操作を確認します。`supported: true` は実装の宣言であり、あなたの権限、空き容量、個別Operationの成功を保証しません。未対応ならResourceを作らず、Host管理者に確認します。

対応Hostでcreateを試す場合は、毎回異なるIdempotency-Keyを使います。`200`なら返されたOperationはterminalです。`202`なら `Location` のOperationをpollし、terminalになるまで待ってからResourceを読みます。

```sh
curl --fail-with-body -X POST "$BASE_URL/resources" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: tutorial-create-001' \
  --data '{"form":"https://forms.publisher.example/key-value-entry/1.0.0","space":"development","name":"welcome-entry","spec":{"key":"welcome","value":"Hello, Ada!"}}'
```

応答の `Location` が指すOperationをGETし、terminal成功後、応答のResource UIDを `/resources/{uid}` からGETします。更新は完全な `spec` と現在のgenerationを送り、同じ `key` のまま `value` を置き換えます。削除は `Takoform-Expected-Generation` とIdempotency-Keyを付けてDELETEし、同じOperation規則で完了を確認します。正確なヘッダーと応答の扱いは[HTTP APIのcreate/read/update/delete](/spec/host-api/v2/http#create)を参照してください。

## 次に進む {#continue}

- [Formの規範仕様](/spec/host-api/v2/forms)
- [Host API v2の共通形式と操作](/spec/host-api/v2/http)
- [Form authors向けチェックリスト](/spec/host-api/v2/forms#author-checklist)
