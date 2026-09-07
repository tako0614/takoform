---
title: このサイトについて
---

# このサイトについて {#この-site-について}

Takoformの仕様、Goライブラリ、検証ツールのドキュメントを掲載しています。
日本語のページは解説です。実装の基準となる仕様は、各ページからリンクしている
リポジトリ内の原文を参照してください。

## 掲載内容 {#この-repository-が扱う範囲}

- Host API v1と、その要求・応答に使うデータ形式。
- Formの定義、配布、検証に共通する仕組み。
- 公開JSON Schemaと検証ツールの使い方。
- 架空のFormを使ったパッケージ作成と、ローカルHTTPテスト環境でのGoクライアントの実行例。

公開する個別Formの設定項目や利用例は、そのFormの公開元が提供します。
Hostやクライアントの対応状況、認証情報、料金等は、利用する製品や運用環境で確認してください。

## 仕様とスキーマ {#identity-と配信}

固定された仕様の範囲は
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json)、
公開スキーマの識別子とダイジェストは
[`public-schema-identities.json`](https://github.com/tako0614/takoform/blob/main/release/public-schema-identities.json)
に記録されています。

スキーマは `$id` に対応するパスで、記録された内容をそのまま配信します。
案内文やデザインの変更によって、これらの仕様やスキーマが変わることはありません。

## 対応状況の確認 {#この-site-が主張しないこと}

このサイトの検証例は、特定のHostの稼働やFormへの対応、本番での利用可否を保証するものではありません。
必要な条件は公開元と利用先でそれぞれ確認してください。

## 関連ページ {#source-を読む}

- [はじめる](/start/)
- [仕様一覧](/reference/)
- [スキーマ一覧](/schemas/)
- [ソースコード](https://github.com/tako0614/takoform)
- [サイトのビルド・公開手順](https://github.com/tako0614/takoform/blob/main/docs/site.md)
