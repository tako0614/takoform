---
title: 共通モデル
---

# 共通モデル

Takoformでは、リソースの設定や振る舞いをFormとして定義します。定義を配布する単位が
Form Package、検証済みのパッケージと参照関係をまとめたものがSnapshotです。

公開元によって形式や検証手順が変わることはありません。このページは概要を説明します。
厳密な要件は [仕様一覧](/reference/) から確認してください。

## 定義を識別する {#identity-の文法}

| 項目 | 内容 |
| --- | --- |
| Form Familyの名前空間 | 公開元が逆DNS形式で管理する名前。バージョンや `/` を含めない |
| FormRef | `apiVersion`、`kind`、`definitionVersion`、`schemaDigest` の4項目 |
| `definitionVersion` | Formの設定と振る舞いの互換性を表すバージョン |
| `schemaDigest` | RFC 8785に従って正規化したForm Definitionのダイジェスト |
| `packageDigest` | パッケージ索引のダイジェスト。FormRefには含まれない |

名前空間を変更すると定義とダイジェストも変わり、別のFormになります。

## 主なデータ型 {#data-の層}

- [Form Definition](/spec/form-definition/)：識別情報と、設定・状態・出力の形式を記述します。
- [Form Package](/spec/form-package/)：一つのForm定義と収録ファイルをまとめます。実行コードは含みません。
- [Snapshot](/spec/core/)：検証済みのデータと参照関係を、入力順に依存せず構築します。
  構築後は変更できません。検証に失敗した場合、不完全なSnapshotは返しません。
- [Interface](/spec/interface-contract/)・[Binding](/spec/binding-contract/)：操作やリソース間の
  接続に必要な能力を定めます。名前から推測せず、ダイジェストで特定した定義を参照します。
- [Artifact](/spec/artifact-transport/)：内容のダイジェストで識別するマニフェストとバイナリデータです。
  ダイジェスト自体はアクセス権限や認証情報ではありません。
- [Standard Services](/spec/standard-services/)：外部プロトコルを、定められた項目から参照します。
- [署名と失効情報](/spec/trust/)：呼び出し側が指定する信頼ポリシーに従って、配布物の来歴を検証します。

## バージョンの関係 {#named-stream-は四つ、domain-axis-は二つ}

APIとFormには、それぞれ互換性を表すバージョンがあります。CoreとProviderの
リリース番号は、それらとは別に管理します。

| 対象 | バージョンが示すもの |
| --- | --- |
| Host API | APIの互換性。現在は `forms.takoform.com/v1` |
| Form定義 | 各Formの設定と振る舞いの互換性。`definitionVersion` で指定 |
| Core | GoライブラリやCLIのリリース。現在は `v1.1.0` |
| Provider | Terraform / OpenTofu向け実装のリリース |

CoreやProviderを更新しても、APIやFormの識別子が自動的に変わることはありません。
スキーマやパッケージの `$id`、InterfaceやBindingの参照、署名等の記録も、APIやFormとは
別のバージョン軸を追加するものではありません。Host APIにマイナーバージョンのURLはありません。

## 公開元と利用先 {#publisher-の平等}

Coreには特定の公開元を優先するリストや `official` フラグはありません。
どの公開元を信頼するかは、利用者や運用者がポリシーとして指定します。

パッケージを検証できること、Hostにインストールされていること、対応・有効化されていること、
商用サービスとして提供されていることは別です。利用するHostで必要な条件を確認してください。

## 次に読む

- [はじめる](/start/) — パッケージを検証してSnapshotを作成する。
- [Host APIの概要](/host-api/) — リソースを操作するAPI。
- [バージョンと互換性](/spec/versioning) — 詳しい規則。
- [用語集](/glossary) — 用語の説明。
