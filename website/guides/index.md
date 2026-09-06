---
title: 実装ガイド
---

# 実装ガイド

作りたいものに合わせて、関連する仕様を紹介します。まず動かしてみたい場合は
[はじめる](/start/) を読んでください。実装時の要件は、リンク先の英語の仕様が基準です。

## 全体の設計を理解する {#architect}

1. [共通モデル](/model/) — FormRef、Form Package、Snapshotの関係。
2. [移植性の範囲](/spec/portability-boundary) — Formで定義する内容と、Hostや運用者が決める内容。
3. [バージョンと互換性](/spec/versioning) — API・Formのバージョンと、各実装のリリースの関係。

Formはサービスの設定や振る舞いを表します。アカウント、認証情報、配置先、料金、
バックエンドの選択は、利用するHostや運用環境で決めます。

## Goライブラリでパッケージを扱う {#core-artifact-user}

1. [はじめる](/start/) のコマンドで、パッケージの検証とSnapshotの作成を試す。
2. [Form Package](/spec/form-package/) で、収録ファイルとダイジェストの計算方法を確認する。
3. [Snapshot](/spec/core/) で、参照先の検証、既定値、入力順に依存しない構築処理を確認する。
4. [`formpackage`](https://github.com/tako0614/takoform/tree/main/formpackage)、
   [`snapshot`](https://github.com/tako0614/takoform/tree/main/snapshot)、
   [`trust`](https://github.com/tako0614/takoform/tree/main/trust) のAPIを使う。

これらの処理はデータの検証です。Hostへの接続やリソースの作成は行いません。

## Hostやクライアントを実装する {#host-client-implementer}

1. [Host APIの概要](/host-api/) で、接続先の取得とAPIの構成を確認する。
2. [Host API v1](/spec/host-api/v1) で、各エンドポイント、FormRef、同時更新の制御、
   非同期処理、エラーの扱いを確認する。
3. 必要な機能に応じて [Interface](/spec/interface-contract/)、
   [Binding](/spec/binding-contract/)、[Artifactの転送](/spec/artifact-transport/) を読む。
4. 外部プロトコルを使う場合は [Standard Services](/spec/standard-services/) を確認する。

クライアント側のスキーマや状態管理、インポート処理は、そのクライアントで実装します。
Host側ではバックエンド、認証情報、テナントごとのポリシー、Formの有効化を管理します。

## 検証結果を確認する {#verifier-reviewer}

1. [適合性の検証](/conformance/) で、レポートの対象と検証項目を確認する。
2. [適合性の分類](/spec/conformance) で、仕様の要件と検証の分類を確認する。
3. [署名と失効](/spec/trust/) で、呼び出し側が指定する信頼ポリシーと検証に必要なデータを確認する。

パッケージの検証に成功しても、その公開状況や特定のHostで使えるかどうかは分かりません。
公開元と利用先のHostで、それぞれ確認してください。

## OpenTofuから使う {#opentofu-provider-を使う-reader}

OpenTofuの設定例やProviderのスキーマ、状態管理、インポートについては、
[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform) の
ドキュメントを参照してください。

## 個別のFormを調べる {#この-site-にないもの}

各Formの設定項目や利用例は、そのFormの公開元が提供します。このサイトでは、
Formに共通するデータ形式とAPIを説明しています。
