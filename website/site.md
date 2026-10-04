---
title: このサイトについて
---

# このサイトについて {#この-site-について}

Takoformの概念とHTTP API、Form仕様の書き方を説明するサイトです。
v2の規範本文は日本語、v1の規範本文は英語です。各仕様ページに正本のファイルを示します。
案内・具体例と、実装の基準となる規範は区別しています。

## 掲載内容 {#この-repository-が扱う範囲}

- [Host API v2](/v2/)の設計、要求・応答、再試行と復旧。
- Formの識別と公開、入力・出力・挙動の記述方法。
- 内容を固定して保存するv1の仕様、公開JSON Schema、既存Goライブラリの利用案内。
- 架空のFormを使ったAPIの具体例。v1の資料にはGoクライアントのローカル実行例もあります。

公開する個別Formの設定項目や利用例は、そのFormの公開元が提供します。
Hostやクライアントの対応状況、認証情報、料金等は、利用する製品や運用環境で確認してください。
OpenTofuやTerraformでHostを使う場合は、Providerの
[HCLクイックスタート](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start)
を参照してください。Formの公開元はそれぞれのサイトで定義や利用例を案内します。

## 仕様とスキーマ {#identity-と配信}

v2の規範本文と解説を原文から生成しています。v2の正式公開状況は[概要](/v2/)に記載します。
v1の固定された仕様の範囲は
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

- [v2を読む](/v2/)
- [v1ライブラリを使う](/start/)
- [仕様一覧](/reference/)
- [スキーマ一覧](/schemas/)
- [ソースコード](https://github.com/tako0614/takoform)
- [OpenTofu / Terraform の HCLクイックスタート](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start)
