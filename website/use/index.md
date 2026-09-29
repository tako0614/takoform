---
title: OpenTofu / Terraform から使う
description: インフラの設定ファイルから Host API v1 を扱うときの入口です。接続先の取得、route、FormRef、バージョンの軸、provider と publisher の境界をまとめます。
---

# OpenTofu / Terraform から使う {#use}

インフラの設定ファイル（Terraform / OpenTofu の HCL）を書く人が、Takoform の Form を
既存の provider から扱うときの入口です。Takoform は公式の provider を指定しません。
どの provider を使うかは利用者の選択であり、Takoform が決めることではありません。
その provider が Host API v1 を話すなら、Terraform や OpenTofu の設定から、Takoform の
Host と同じ API をそのまま扱えます。

このページは案内です。実装の要件は [Host API v1](/spec/host-api/v1) が定めます。

## このサイトが公開するものと、provider ごとに違うもの {#boundary}

- このサイトが公開するのは、Host API v1 の契約と、publisher に共通するデータモデル
  （FormRef、Form Definition、Form Package、Snapshot）です。
- resource の種類、state の持ち方、import、診断、リリース番号は、使う provider の
  仕様です。Takoform はこれらを API の仕様に含めません。
- 個々の Form の設定項目、利用例、対応する定義バージョンは、その Form を公開する
  publisher のサイトにあります。takoform.com は API と共通モデルだけを配信し、
  個々の Form の内容は配信しません。

## 接続先と route {#api}

Host に接続するときは、まず discovery を読みます。返る API は
`forms.takoform.com/v1` の一つで、API の基点は `/apis/forms.takoform.com/v1` です。
接続先はこの discovery と同じオリジンである必要があります。
次の表は、この基点から先の route です。

| 目的 | リクエスト |
| --- | --- |
| Host が持つ Form の一覧 | `GET /forms` |
| Form の Definition（`desiredSchema` を含む） | `GET /form-definitions/{formGroup}/{kind}` |
| 送信内容の検証（変更なし） | `POST /resources/validate` |
| 変更内容の確認（変更なし） | `POST /resources/prepare` |
| 作成・更新・読み取り・削除 | `PUT` / `GET` / `DELETE /resources/{formGroup}/{kind}/{name}` |
| Host が観測した状態への更新 | `POST /resources/{formGroup}/{kind}/{name}/observe` |
| 既存リソースの取り込み | `POST /resources/{formGroup}/{kind}/{name}/import` |
| 非同期処理の取得と中止 | `GET /operations/{id}`、`POST /operations/{id}/cancel` |
| artifact の登録 | `POST /artifacts/uploads`、`PUT /artifacts/uploads/{uploadId}/blobs/{sha256}`、`POST /artifacts/uploads/{uploadId}/commit` |
| artifact と blob の取得、upload の破棄 | `GET /artifacts/{manifestDigest}`、`HEAD /artifacts/blobs/{sha256}`、`DELETE /artifacts/uploads/{uploadId}` |
| Host が宣言する Form | `GET /support/forms`、`GET /support/forms/{formGroup}/{kind}/{definitionVersion}` |
| Host が宣言する Interface / Binding / 外部プロトコル | `GET /support/interfaces/{name}/{version}`、`GET /support/bindings/{name}/{version}`、`GET /support/standard-services/{protocol}` |

操作、HTTPステータス、エラー、再試行の可否は
[`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
が正本です。`GET /forms` と `/support/...` は Host が **宣言する** 対応状況であり、
特定の Form が公開されていることや、本番で使えることを示すものではありません。

## どの Form を扱うかを指定する {#formref}

リソースは、4項目からなる正確な FormRef で特定します。

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.3.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

- `apiVersion`：バージョンを持たない reverse-DNS の publisher group。
- `kind`：Form の種類。
- `definitionVersion`：その Form 自身のバージョン。
- `schemaDigest`：変更されない Definition の RFC 8785 ダイジェスト。

4項目すべてが一致している必要があります。`latest`、バージョンの省略、group と kind だけの
指定は使えません。バージョンは `definitionVersion` に入り、パスの2つ目のセグメントには
なりません。指定された定義を解決できない場合は、リソースを変更する前に `form_unknown`
を返します。

## バージョンの読み方 {#versions}

互換性を表す軸は2つです。

| 軸 | identity | 何の互換性か |
| --- | --- | --- |
| Host API | `forms.takoform.com/v1` | discovery と wire contract |
| Form definition | 各 FormRef の `definitionVersion` | その Form の desired-state contract |

Core ライブラリや provider のリリース番号は、普通のソフトウェア成果物の semver です。
Takoform API や Form のバージョンではないので、ライブラリや provider を更新しても
API の URL は変わりません。`/v1.1` のような中間の lane はありません。

## 変更を適用するまで {#lifecycle}

1. `POST /resources/prepare` で変更内容を確認します。`prepare` はリソースを変更せず、
   `review.prepareDigest` を含む応答を返します。
2. `PUT /resources/{formGroup}/{kind}/{name}` に `review` を付けて適用します。作成は
   `If-None-Match: *`、更新は `Takoform-Expected-Generation` などの世代番号で
   同時更新を防ぎます。必要な指定がない場合は `invalid_argument`、世代が古い場合は
   `generation_conflict` です。
3. 適用が `202 Accepted` を返した場合は Operation になります。`GET /operations/{id}`
   で終了を確認します。

`generation` は指定した状態が変わったときに進み、`revision` は Host が返す状態や出力が
変わったときにも進みます。`generation` を手で増やして指定しません。変更の適用には
idempotency key を付け、同じ操作を繰り返しても結果が重複しないようにします。同じ key を
別の内容で使うと `invalid_argument` になります。

Terraform や OpenTofu の state や plan をこの API のどれに対応させるかは、使う provider が
決めます。手元の state と Host の `generation` / `revision` がずれた場合は、
`GET /resources/{formGroup}/{kind}/{name}` で現在の状態を読み、世代番号を合わせてから
再試行してください。タイムアウトは「変更されなかった」という意味ではありません。

## 設定ファイルから使う前に確認すること {#check}

| 確認すること | どこで確認するか |
| --- | --- |
| 使う provider が Host API v1 を扱えるか、resource と state の形式 | その provider のドキュメント |
| 接続先 Host が、その Form の正確な FormRef をインストールしていて、現在の呼び出し元に許可しているか | Host と `GET /forms`、`/support/...` の応答 |
| Form の設定項目、利用例、対応する定義バージョン | その Form を公開する publisher のサイト |
| パッケージの検証、Hostへのインストール、対応、有効化、商用提供 | Host と publisher にそれぞれ確認する |

パッケージの検証に成功したこと、ある Form が公開されていること、Host がその Form に
対応していること、有効化されていること、商用提供されていることは、それぞれ別の事実です。
このページやこのサイトの検証例は、それらを保証しません。

このサイトは特定の provider を指定しません。OpenTofu / Terraform から Host API v1 を
扱う実装の一つに
[`terraform-provider-takoform`](https://github.com/tako0614/terraform-provider-takoform)
があります。その HCL の書き方、state、対応バージョンは、その provider のドキュメントが
正本です。

## 次に読む {#next}

- [Host API v1](/spec/host-api/v1) — エンドポイント、FormRef、同時更新、非同期処理、エラー。
- [Host APIの概要](/host-api/) — discovery から操作までの概要。
- [GoからHostを使う](/client/) — 同じ流れを Core のクライアントから実行する例。
- [共通モデル](/model/) — FormRef、Definition、Package、Snapshot の関係。
- [バージョンと互換性](/spec/versioning) — バージョンの規則。
