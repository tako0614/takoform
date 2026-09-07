---
title: GoからHostを使う
---

# GoからHostを使う {#client}

Coreの `hostclient` は、Hostの接続先を確認し、Formへの対応確認、変更の事前確認、
リソースの作成・更新を行うGoクライアントです。非同期の応答ではOperationの完了を待ちます。
まずローカルのHTTPテスト環境で、一連の呼び出しを試します。

## ローカルで動かす {#run}

所要時間の目安は5分です。GoとGit、初回のソース・依存取得にはネットワーク接続が必要です。
既にこのリポジトリを取得している場合は、そのルートで最後の2行を実行してください。

```sh
git clone https://github.com/tako0614/takoform.git
cd takoform
go mod download
go test -v ./hostclient -run '^ExampleClient_ApplyResource$' -count=1
```

テストは次の出力を検証し、`PASS` で終了します。

```text
greeting example-uid true
discovery -> availability -> prepare -> apply
```

ループバック接続のテストサーバーに、架空のFormと固定の応答を用意しています。
認証情報、外部サービス、永続データは使いません。これは呼び出しを学ぶためのテストであり、
配備して使えるHost実装ではありません。

## クライアントの呼び出し {#call}

<<< @/../hostclient/example_test.go#client{go}

1. `New` にHostのoriginと認証用トークンを渡します。このテストではトークンは空です。
2. `Discover` がAPIの接続先と必要な機能を確認します。
3. `ApplyResource` が正確なFormRefへの対応・許可を確認し、`prepare` の結果を使って作成します。
4. この例は同期の `201 Created` で完了します。実Hostが `202 Accepted` を返した場合、
   同じメソッドがOperationを取得して完了を待ちます。

テストサーバーを含むコード全体は
[`hostclient/example_test.go`](https://github.com/tako0614/takoform/blob/main/hostclient/example_test.go)
で読めます。通信形式だけを読みたい場合は [Host APIの要求・応答例](/start/#_3-host-apiの要求・応答例を読む) を参照してください。

## 実際のHostを使う前に {#real-host}

| 用意するもの | 確認する内容 |
| --- | --- |
| Hostのoriginと認証方法 | 利用するHostのドキュメントから取得する。Form Familyの名前空間は接続先ではない |
| FormRefと設定 | 検証した定義の正確なバージョン・ダイジェストと、その定義に合う入力を使う |
| spaceとリソース名 | 操作対象の範囲と名前を決める |
| 利用権限 | 対象HostがそのFormと操作を、現在の呼び出し元に許可していることを確認する |

現在の `hostclient` では、prepareの応答で省略した既定値が追加されるとエラーになります。
既定値を持つFormは、信頼ポリシーに従って受け入れた正確なパッケージからSnapshotを作り、
`Snapshot.Materialize` で既定値を補完してから、その結果を `Resource.Spec` に渡してください。
結果のJSONは `formpackage.DecodeStrictIJSON` で `map[string]any` に読み込めます。
これはスキーマの既定値に対する対処です。Hostが行うホスト名などの正規化によって設定が
変わる場合も、現在のクライアントはそのprepare応答を拒否します。Host API v1が要求する
Host側の補完・正規化と、その応答の受け入れには、まだ実装の差があります。
このページのテスト用Formには既定値も正規化もありません。

これらを用意してから `server.URL`、トークン、`desired` を置き換えます。
実Hostへのapplyはリソースを変更します。認証情報はソースやログに書かないでください。

## 更新・失敗を扱う {#changes}

空の `Fence` は新規作成用です。更新する場合は、取得したResourceのUIDとgenerationを
`Fence` に渡し、他の変更を上書きしないようにします。generationを手で増やして指定しません。

タイムアウトは「何も変更されなかった」という意味ではありません。対象ResourceやOperationの
状態を確認してから再試行してください。詳細は [Host API v1](/spec/host-api/v1)、
実装側の概要は [Host API](/host-api/)、検証範囲は [適合性の検証](/conformance/) を参照してください。
