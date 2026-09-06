---
title: Host APIの概要
---

# Host APIの概要 {#host-api-v1-とは}

Host APIは、Formで定義したリソースを作成・取得・更新・削除するためのHTTP APIです。
APIを提供する実装をHostと呼びます。Hostは対応するFormの定義をインストールし、
その定義に従って設定を受け取り、リソースの状態を返します。

このページは概要です。実装時の要件は [Host API v1の仕様](/spec/host-api/v1) を参照してください。

## 接続先を取得する {#discovery-と-api-root、lifecycle-root}

まず `/.well-known/takoform/v1` にアクセスし、対応APIバージョンと接続先を取得します。
この接続先を基準に、各リソースの操作先URLを組み立てます。

| 用途 | URL |
| --- | --- |
| 接続先情報の取得 | `GET /.well-known/takoform/v1` |
| APIの基点 | `/apis/forms.takoform.com/v1` |
| リソースの操作 | `{api}/resources/{formGroup}/{kind}/{name}` |

接続先情報が返すAPIバージョンは一つです。APIの接続先は、この情報を取得したURLと
同じオリジンである必要があります。ユーザー情報、クエリ、フラグメント、パーセント
エンコードを含むURLは使えません。平文HTTPを使えるのは、開発時のループバック接続だけです。

CoreやProviderのリリース番号と、APIバージョン `forms.takoform.com/v1` は別です。
ライブラリの更新だけでAPIのURLが変わることはありません。

## APIが定める操作 {#wire-に入るもの、入らないもの}

接続先の取得、入力検証、変更の事前確認、作成・更新・取得・削除・インポート、
状態の観測、同時更新の制御、非同期処理、エラー形式を定めています。

個別のFormが何を意味するか、Hostがどのバックエンドで処理するかはAPI共通の仕様には
含めません。リソース固有の操作は、そのFormが参照するInterfaceやBindingで定義します。

## 使用するFormを指定する {#四要素の-formref}

FormRefは次の4項目で一つのForm定義を特定します。以下は形式を示す例です。

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.3.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

4項目すべてが一致している必要があります。`latest` やバージョンの省略、名前だけの
指定には置き換えられません。指定された定義を解決できない場合は、リソースを変更する前に
`form_unknown` を返します。

## リソースの識別と同時更新 {#identity-は三つの値で見る}

- `uid`：リソースを作成したときの識別子。削除して作り直すと別の値になります。
- `generation`：利用者が指定した状態の変更に伴って進む番号。`1` から始まります。
- `revision`：Hostが返す状態や出力の変更でも進む番号。`1` から始まります。

作成時には `If-None-Match: *` を指定します。更新、状態の観測、既存リソースの事前確認、
削除では、操作ごとに定められた世代番号を指定して同時更新を制御します。

必要な指定がない場合は `invalid_argument`、世代が古い場合は `generation_conflict`、
リビジョンが古い場合は `revision_conflict`、リソースが作り直されていた場合は
`uid_mismatch` を返します。各操作の詳細は仕様の操作一覧を確認してください。

## エラー {#閉じた-error-語彙}

エラーコード、HTTPステータス、再試行の可否は
[`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
で定めています。実装ごとに独自の共通エラーコードを追加することはできません。

## スキーマと操作一覧 {#machine-document}

| ファイル | 内容 |
| --- | --- |
| [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json) | 操作と同時更新の制御 |
| [`host-discovery.schema.json`](https://forms.takoform.com/schemas/v1/host-discovery.schema.json) | 接続先情報 |
| [`form-ref.schema.json`](https://forms.takoform.com/schemas/v1/form-ref.schema.json) | FormRef |
| [`host-api-wire.schema.json`](https://forms.takoform.com/schemas/v1/host-api-wire.schema.json) | リソースとエラーの形式 |
| [`operation.schema.json`](https://forms.takoform.com/schemas/operations/v1/operation.schema.json) | 非同期処理の記録 |
| [`host-support-profile.schema.json`](https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json) | Hostの対応状況 |

## 次に読む

- [はじめる](/start/) — パッケージの検証とAPIの要求・応答例。
- [共通モデル](/model/) — 定義、パッケージ、Snapshotの関係。
- [適合性の検証](/conformance/) — 検証結果の読み方。
- [バージョンと互換性](/spec/versioning) — バージョンに関する詳しい規則。
