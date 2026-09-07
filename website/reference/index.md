---
title: 仕様一覧
---

# 仕様一覧

実装の基準となる仕様と、理解を助けるガイドをまとめています。
このページ自体は索引であり、新しい要件を定めるものではありません。

## 仕様

以下は英語で記述された、変更内容が固定されている仕様です。
各ページの冒頭から、リポジトリ内の原文を確認できます。

| 文書 | 内容 |
| --- | --- |
| [Host API v1](/spec/host-api/v1) | HTTP APIのエンドポイントと要求・応答 |
| [Conformance](/spec/conformance) | 要件の読み方と適合性の分類 |
| [Versioning](/spec/versioning) | バージョン、識別子、互換性 |
| [Form Definition](/spec/form-definition/) | Formの設定項目と振る舞いの定義 |
| [Form Package](/spec/form-package/) | 定義の配布形式と検証 |
| [Snapshot](/spec/core/) | 検証済みパッケージと参照関係のまとめ方 |
| [Interface](/spec/interface-contract/) | 操作、入出力、エラーの定義 |
| [Binding](/spec/binding-contract/) | リソース間の接続に必要な能力と役割 |
| [Artifact transport](/spec/artifact-transport/) | ファイル等のデータの識別と転送 |
| [Standard Services](/spec/standard-services/) | 外部プロトコルへの参照 |
| [Trust and revocation](/spec/trust/) | 署名、信頼ポリシー、失効情報 |
| [Form families](/spec/form-families) | 公開元が管理する名前空間 |
| [Portability boundary](/spec/portability-boundary) | Formに含める内容と運用環境で決める内容 |

固定対象のファイルとダイジェストは
[`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json)
に列挙されています。サイト上の仕様は原文のリンク先だけを置き換えて掲載しています。
要件を確認する際の正本は、リポジトリ内のファイルです。

[仕様の概要](/spec/)、[Host APIの索引](/spec/host-api/)、
[スキーマの索引](/spec/schemas/) は案内用のページで、固定された仕様本文ではありません。

## JSON Schemaと検証データ

[スキーマ一覧](/schemas/) から、各スキーマの `$id` に対応するJSONファイルを取得できます。
JSON Schemaが検証するデータ構造に加え、仕様本文にある意味上の制約も満たす必要があります。

- [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
  — APIの操作、同時更新の制御、ステータス、エラーの一覧。
- [`generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json)
  — パッケージやSnapshotを検証するためのテストデータ。

## 日本語ガイド

ガイドは仕様の解説であり、仕様に要件を追加するものではありません。

| 文書 | 内容 |
| --- | --- |
| [はじめる](/start/) | 手元で実行する検証と、APIの要求・応答例 |
| [実装ガイド](/guides/) | 作りたいものに応じた関連仕様 |
| [Formを作る](/authoring/) | 定義を作り、パッケージを組み立てて検証するGoの例 |
| [GoからHostを使う](/client/) | 接続先確認からprepare・applyまでを実行する例 |
| [Host APIの概要](/host-api/) | 接続先の取得とAPIの構成 |
| [共通モデル](/model/) | 主なデータ型の関係 |
| [適合性の検証](/conformance/) | 検証結果の読み方 |
| [用語集](/glossary) | 仕様で使う用語の説明 |
| [このサイトについて](/site) | 掲載内容と公開方法 |
