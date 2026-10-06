---
title: このサイトについて
---

# このサイトについて {#この-site-について}

Takoformの概念とHTTP API、Form仕様の書き方を説明するサイトです。
[v1](/v1/)と[v2](/v2/)を分けて案内しています。上部の版選択で切り替えられ、目次と検索は読んでいる版に合わせて表示します。
言語は版と別に選べます。仕様本文は英語の原文、ガイドは日本語と英語です。
案内・具体例と、実装の基準となる規範は区別しています。v1の仕様は固定済み、v2は改訂可能です。

## 掲載内容 {#この-repository-が扱う範囲}

- [Host API v2](/v2/)の設計、要求・応答、再試行と復旧。
- Formの識別と公開、入力・出力・挙動の記述方法。
- 変更せず保持するv1の仕様、公開JSON Schema、および既存ソフトウェアのv1利用資料。
- 架空のFormを使ったAPIの具体例。例は稼働中のHostや公開Formを示しません。

公開する個別Formの設定項目や利用例は、そのFormの公開元が提供します。
Hostやクライアントの対応状況、認証情報、料金等は、利用する製品や運用環境で確認してください。
OpenTofuやTerraformで既存のv1 Hostを使う場合は、Providerのv1
[HCLクイックスタート](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start)
を参照してください。これはv2対応を示しません。Formの公開元はそれぞれのサイトで定義や利用例を案内します。

## 仕様とスキーマ {#identity-と配信}

v2の規範本文と解説は改訂可能な英語の原文から生成しています。原文と規範・解説の区別は、
各v2仕様ページの表示と[概要](/v2/)で確認できます。
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
- [v1を読む](/v1/)
- [仕様一覧](/reference/)
- [スキーマ一覧](/schemas/)
- [ソースコード](https://github.com/tako0614/takoform)
- [OpenTofu / Terraform の HCLクイックスタート](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start)
