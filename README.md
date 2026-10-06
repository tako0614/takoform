# Takoform

Takoformは、資源の仕様を作者がHTTPSで公開し、その仕様を実装するHostを共通のHTTP APIで
操作するためのプロトコルです。データベースやストレージなど、何を作り、どの入力を受け付け、
更新・削除で何が起きるかは、**Form**という資源ごとの仕様で定義します。

現在の文書はHost API v2を中心に構成しています。**v2の規範本文は英語**で、
日本語の入口・解説はその理解を助ける資料です。仕様を読むためにGoライブラリや
特定のProviderを導入する必要はありません。

## 読み始める

| 目的 | 入口 |
| --- | --- |
| Takoformの仕組みを知る | [概要と用語](spec/host-api/v2/README.md) / [日本語の概念ガイド](website/model/index.md) |
| 資源を操作する流れを知る | [日本語の入門](website/start/index.md) / [HTTPの往復例](spec/host-api/v2/examples.md) |
| クライアントを作る | [クライアントガイド](website/client/index.md) / [HTTP API](spec/host-api/v2/http.md) |
| 自分のFormを定義する | [Form作者向けガイド](website/authoring/index.md) / [Formの要件と完成例](spec/host-api/v2/forms.md) |
| Hostを実装する | [Host実装ガイド](website/host-api/index.md) / [HTTPの適合条件](spec/host-api/v2/http.md#conformance) |
| 既存v1の資源・実装を引き継ぐ | [Migration](spec/host-api/v2/migration.md) / [固定済みv1仕様](spec/host-api/v1.md) |

公開サイトは [takoform.com](https://takoform.com/) です。
英語の説明は [English documentation](website/en/v2/index.md) から読めます。

## 仕様の構成

規範文書は、[共通モデル](spec/host-api/v2/README.md)、
[HTTP API](spec/host-api/v2/http.md)、[Formの要件](spec/host-api/v2/forms.md)です。
英語本文が実装の基準です。例、ガイド、翻訳は独立した適合条件を追加しません。

- Formは版固定のHTTPS URLで識別します。HostのAPI接続先とは別です。
- Hostは明示的に実装したFormへの対応を返します。仕様が存在するだけで自動対応しません。
- Resourceは管理対象と希望状態・観測状態を、Operationは受理した変更と結果を表します。
- 競合する更新、応答喪失、再起動、結果不明・部分失敗の復旧もHTTP契約に含まれます。
- Offering、事前確認、秘密入力は独立した任意機能です。

v1・v2の規範本文は固定されています。仕様の意味を変更する場合は、別のAPI majorで定義します。
公開版は[takoform.com](https://takoform.com/v2/)で確認できます。解説やサイトの改善で仕様は変わりません。
仕様の公開と、各Hostの実装対応は別の状態です。

個別Formの定義・利用例は、その作者のサイトが所有します。ここには中央カタログや
Hostの稼働状況を置きません。SDKや各Providerは独立した実装であり、仕様そのものではありません。

## 保持するv1の資料とコード

v1の規範本文と公開スキーマは変更せず保持します。v2は独立した契約です。

- [v1 HTTP API](spec/host-api/v1.md)と[固定範囲](spec/host-api/v1.freeze.json)
- [v1の契約・スキーマ一覧](spec/README.md#published-host-api-v1-reference)
- 既存Goライブラリ: [formpackage](formpackage/)、[snapshot](snapshot/)、
  [hostclient](hostclient/)、[trust](trust/)

これらのGoコードはv1向けです。v2のSDKや導入要件として扱いません。
既存のローカル検査は次のとおりです。架空の検査用データを使い、実際のHostに資源を作りません。

```console
go mod download
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

`go mod download`以降は、取得済みの依存とローカルデータで検査します。
v1とv2の契約差は[Migration](spec/host-api/v2/migration.md)にまとめています。

## 文書とサイトの開発

```console
bun install --frozen-lockfile
bun run check
```

`check`は文書の境界、固定済みv1・v2、生成元との一致、リンク、既存Goコード、サイトbuildを
確認します。公開サイトや実資源は変更しません。生成ページを直接編集せず、
規範は`spec/host-api/v2/`から参照し、日英の解説は`website/`の対応する元ファイルを編集します。

```console
bun scripts/site.mjs --write
bun run build:site
bun run site:preview
```

プレビューはローカルの候補です。公開・固定・実装の対応を同じ完了状態にまとめません。
サイトの範囲は[このサイトについて](website/site.md)、公開の運用は[サイト開発文書](docs/site.md)を参照してください。

## License

MIT
