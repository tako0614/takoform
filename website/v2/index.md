# Host API v2 仕様

Form 作者は、資源の意味と操作を記した仕様を版固定 URL で公開します。Host は対応する Form を実装し、クライアントは共通 API を使って資源を作成・一覧・取得・更新・削除します。Form は入力、観測状態、出力、各操作の意味を定め、Host はその契約を実行します。Host が要求 URL から仕様やコードを自動取得する方式ではありません。

以下は v2 の仕様本文です。正式な公開・release・freeze はまだ行われていません。

## 仕様

- [責任分担と設計概要](/spec/host-api/v2/)
- [HTTP API の要求・応答](/spec/host-api/v2/http)
- [Form 仕様の要件](/spec/host-api/v2/forms)
- [作成から削除までの具体例](/spec/host-api/v2/examples)

## Host API v1

[凍結済みの v1 仕様](/spec/host-api/v1)は既存契約を参照するために引き続き掲載しています。v2 の作業は v1 を変更しません。
