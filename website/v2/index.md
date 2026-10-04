# Host API v2 仕様

資源を作成・取得・更新・削除するための共通HTTP APIです。
資源固有の意味は、作者が公開するFormの仕様で定義します。
Hostは対応するFormを実装し、クライアントはその仕様に従って操作します。

以下にv2の仕様本文を掲載します。正式公開前の内容です。

## 仕様

- [概要と基本概念](/spec/host-api/v2/)
- [HTTP API の要求・応答](/spec/host-api/v2/http)
- [Formの定義と完成例](/spec/host-api/v2/forms)
- [作成から削除までの具体例](/spec/host-api/v2/examples)
- [v1 からの移行案内](/spec/host-api/v2/migration)

## 読む順序

- Form 作者: [Form 仕様](/spec/host-api/v2/forms)から、必要に応じて[具体例](/spec/host-api/v2/examples)へ進みます。
- Host 実装者: [概要](/spec/host-api/v2/)で責任範囲を確認し、[HTTP API](/spec/host-api/v2/http)と[Form 仕様](/spec/host-api/v2/forms)を読みます。
- クライアント実装者: [具体例](/spec/host-api/v2/examples)で操作の流れを確認し、[HTTP API](/spec/host-api/v2/http)で要求・応答の詳細を調べます。
- 既存のv1利用者: [Migration](/spec/host-api/v2/migration)で変更点と引継ぎ時の確認事項を読みます。
