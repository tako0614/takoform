---
title: Formを作る
---

# Formを作る {#authoring}

Formは、リソースの設定項目と、その設定が意味する振る舞いを記述するものです。
定義をパッケージにまとめると、公開元、クライアント、Hostが同じ内容を検証できます。
ここでは小さな定義からパッケージを組み立て、入力の検証と改変の検出まで試します。

## まず動かす {#run}

所要時間の目安は5分です。GoとGit、初回のソース・依存取得にはネットワーク接続が必要です。
既にこのリポジトリを取得している場合は、そのルートで最後の2行を実行してください。

```sh
git clone https://github.com/tako0614/takoform.git
cd takoform
go mod download
go test -v ./formpackage -run '^ExampleVerifyFS$' -count=1
```

テストは次の出力を検証し、`PASS` で終了します。

```text
GreetingPolicy 1
changed payload rejected: true
```

例は架空の `GreetingPolicy` を使います。ローカルの一時データだけを扱い、
署名、パッケージの公開、Host上のリソース作成は行いません。

## 設定と意味を定義する {#definition}

この例の設定は、40文字以内の挨拶の接頭辞です。作成時にそのまま保存し、
更新時に置き換え、削除時に取り除く方針を定義します。実行用のエンドポイントはありません。

<<< @/../formpackage/example_test.go#definition{go}

`desiredSchema` は入力の形を検証します。それだけでは「更新で何が変わるか」や
「失敗後に再試行できるか」は決まりません。実用のFormでは、ライフサイクル、失敗時の扱い、
必要なInterfaceやBindingまで定義します。同じFormとして提供できる振る舞いの範囲は
[Form Definition](/spec/form-definition/) と [移植性の範囲](/spec/portability-boundary) を参照してください。

## パッケージを組み立てて検証する {#package}

次のコードは上の定義と入力を検証し、`definition.json` と `package-index.json` を持つ
仮想ファイルシステムを組み立てます。`VerifyFS` は一時ディレクトリを使って内容を検証し、
処理後にそのディレクトリを削除します。

<<< @/../formpackage/example_test.go#authoring{go}

`schemaDigest` は正規化した定義を識別します。一方、索引の各ファイルの `digest` と
`size` は収録したバイト列そのものを検証します。例の最後では定義ファイルに改行を足し、
索引を更新しないまま再検証して、改変が拒否されることを確認しています。

ファイルとして配布するときも同じ定義と索引を保存し、すべての収録ファイルと参照先を揃えます。
索引の形式と計算規則は [Form Package](/spec/form-package/) が基準です。

## 公開前に揃えるもの {#publish}

1. 公開元が管理する名前空間と、Formの用途・振る舞いを決める。
2. 設定、更新・削除、エラー、再試行の規則と、それを確認するテストを用意する。
3. [互換性の規則](/spec/versioning) に従ってバージョンを決め、公開済みの内容を上書きしない。
4. [署名と失効の仕様](/spec/trust/) に沿った来歴・署名・失効情報と、利用例・制約の説明を公開元で用意する。
5. 利用するHostが、その正確なFormRefを実装し、対象の利用者に許可しているかを確認する。

署名の検証に成功することと、その公開元を信頼するかは別です。信頼ポリシーは利用者・運用者が
決めます。Coreへの中央カタログ登録で利用可能になる仕組みではありません。

次は [共通モデル](/model/) でSnapshotへの参照のまとめ方を確認するか、
[GoからHostを使う](/client/) でAPIの呼び出しを試してください。
