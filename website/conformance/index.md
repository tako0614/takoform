---
title: 適合性の検証
---

# 適合性の検証 {#conformance-と参照実装}

検証レポートは、対象として記載されたデータや実装について、決められた要件を満たすかを
示します。たとえばパッケージの検証に成功しても、そのFormが特定のHostで使えるとは限りません。

このページは検証結果の読み方を説明します。要件の定義は
[適合性に関する仕様](/spec/conformance) を参照してください。

## 検証の対象 {#claim-を分けて読む}

| 対象 | 主に確認する内容 |
| --- | --- |
| Form Package | 定義、FormRef、正規化した内容、収録ファイル、許可されたデータ形式 |
| Interface / Binding | ダイジェストと定義の一致、操作や能力の定義 |
| Snapshot | 必要なデータと参照先が揃っていること、入力順によらず構築結果が同じになること |
| Host | API、リソース操作、同時更新の制御、再試行、識別子、エラー等の振る舞い |
| クライアント | 宣言された設定だけを送ること、FormRefとパッケージの識別を混同しないこと |
| 公開元の署名等 | 配布物の来歴、署名、公開記録、失効情報 |

一つの検証結果から、ほかの対象の適合性や本番での利用可否まで判断することはできません。

## 手元で検証する {#repository-から実行できる-harness}

[準備手順](/start/#_0-準備) に従って依存モジュールを取得した後、リポジトリのルートで
実行してください。以下の検証はネットワークに接続せず、リソースも変更しません。

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

パッケージ索引、収録ファイル、FormRef、ダイジェストを検証します。

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

パッケージ・Interface・Binding・Snapshotの参照関係、入力順への依存がないこと、失敗時に
不完全な結果を返さないことを検証します。使用する `external-family` と `zero-family` は
テスト用のデータで、実在のFormや稼働中のHostを表すものではありません。

どちらのコマンドも、Host上でのリソース操作やFormの有効化、実行コードの起動は行いません。

## レポートの確認点 {#report-を読むときの確認点}

1. `status` だけでなく、何を対象に検証したレポートかを確認する。
2. FormRefの4項目で、検証した定義を特定する。
3. `packageDigest` はパッケージ索引、`schemaDigest` はForm定義の内容を指すことを区別する。
4. 公開やHost上の操作の結果は、それを行った公開元やHostの記録で別に確認する。

## ソースコード {#source}

検証ツールとテストデータは [GitHub](https://github.com/tako0614/takoform) で公開しています。
OpenTofu向け実装の検証は
[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform) を参照してください。

## 次に読む

- [はじめる](/start/) — コマンドの出力とAPIの要求・応答例。
- [Host APIの概要](/host-api/) — 接続先と主な操作。
- [仕様一覧](/reference/) — 実装の基準となる仕様。
