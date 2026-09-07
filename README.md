# Takoform

Takoform は、portable な resource contract を定義・検証する project です。
publisher が data-only の desired state を一度定義し、Core、client、Host が
同じ exact な bytes と identity を扱います。ここでいう Core は、Form Package
の検証、immutable Snapshot の compile、Host API client、offline trust 検証、
generic conformance を含む Go module です。

最初に押さえる事実は三つです。

- 現在の wire lane は `forms.takoform.com/v1` です。
- 現在の Core module artifact は `github.com/tako0614/takoform@v1.1.0` です。
- FormRef に `official` bit はなく、Takoform は中央の Form catalog を持ちません。

## 最短 quickstart

repository root から、synthetic な conformance fixture を検証できます。clone 直後や
Go module cache が空の場合は、最初に依存を取得します。

```console
go mod download
```

依存が取得済みなら、以下の verifier command は network access を必要とせず、local の
fixture と module cache だけを読みます。これは実在の Form の公開や catalog の例では
ありません。

```console
go run ./cmd/form-package verify conformance/takoform-v1/generic-host/external-family/counter-reservation
```

次に、package と Interface / Binding の bytes を集めて immutable Snapshot へ
compile する generic corpus を実行します。

```console
go run ./cmd/generic-conformance verify --manifest conformance/takoform-v1/generic.json
```

前者は package digest、exact な FormRef、payload の数とサイズを JSON で返します。
後者は `status: "passed"`、`hostApiLane: "forms.takoform.com/v1"`、
`snapshot-compilation`、`permutation-stable`、`no-partial-snapshot` などを含む
machine-readable report を返します。依存が取得済みなら、どちらの command も network
を使わず、Resource を変更しません。入力と出力の読み方は [Start](website/start/index.md)
にあります。

## 読む順番

1. [Start](website/start/index.md) — package verify から Snapshot、概念上の
   Host API request までを一続きで確認します。
2. [Guides](website/guides/index.md) — 読者の役割ごとの入口です。
3. [共通モデル](website/model/index.md) — FormRef、Definition、Package、Snapshot の
   関係を先に読みます。
4. [Host API v1](website/host-api/index.md) — discovery、lifecycle、Operation、fence を
   wire の観点から読みます。
5. [Reference](website/reference/index.md) — 英語の normative source と日本語の案内を
   区別します。

機械的な入口は [spec/README.md](spec/README.md)、語彙の揺れを避けるには
[glossary](website/glossary.md) を使ってください。

## 何がこの repository にあるか

normative な common model と Core の実装は、次の層に分かれています。

- [`spec/form-definition/`](spec/form-definition/) — exact な FormRef と desired /
  observed / output の形。
- [`spec/form-package/`](spec/form-package/) — 一つの exact な Form を閉じ込める
  data-only package。
- [`spec/core/`](spec/core/) — 検証済み contract を順序非依存の immutable Snapshot に
  compile する規則。
- [`spec/host-api/`](spec/host-api/) — discovery、lifecycle、非同期 Operation、identity
  fence、portable error。
- [`spec/interface-contract/`](spec/interface-contract/)、
  [`spec/binding-contract/`](spec/binding-contract/)、
  [`spec/artifact-transport/`](spec/artifact-transport/)、
  [`spec/standard-services/`](spec/standard-services/) — digest-bound な data contract。
- [`spec/trust/`](spec/trust/) — caller が渡す provenance と offline verification の入力。

実装の入口は [`formpackage/`](formpackage/)、[`snapshot/`](snapshot/)、
[`hostclient/`](hostclient/)、[`trust/`](trust/) です。CLI はこれらと同じ検証経路を
使い、invalid input では fail closed します。

## version の読み方

Takoform には名前付きの **4つの version stream** があります。ただし、domain の
互換性を表す **version axis は2つだけ** です。

| stream | identity | 何の互換性か |
| --- | --- | --- |
| Host API lane | `forms.takoform.com/v1` | discovery と wire contract |
| Form definition | 各 FormRef の `definitionVersion` | その Form の desired-state contract |
| Core module | `v1.1.0` | SDK、CLI、verifier、compiler、client の artifact |
| Provider | 独立した SemVer | Terraform / OpenTofu client artifact |

Host API lane と Form definition が二つの domain axis です。Core と Provider の
release number、package / schema の `$id`、package digest、Interface / Binding ref、
trust record は、それぞれの artifact や reader、bytes を識別します。これらは Host
API や Form の version へ暗黙に変換されません。`/v1.1` という Host route もありません。

## publisher と所有境界

すべての publisher が同じ FormRef、package 検証、canonical digest、trust、revocation、
Snapshot、installation、Host support、activation の経路を通ります。provenance と policy
を選ぶのは operator で、Core に privileged publisher allowlist はありません。検証済み
であること、installation、Host support、activation、commercial Offering は別々の事実です。

この repository が所有するのは、neutral な contract、Core 実装、generic conformance、
公開 schema とその identity です。ここには次のものはありません。

- 個別 Form の source、definition、example、publisher catalog
- Host implementation、backend state、target、credential、activation、billing
- Terraform / OpenTofu の mapping、state、import、診断、release の仕様

OpenTofu / Provider の利用者は、[terraform-provider-takoform](https://github.com/tako0614/terraform-provider-takoform)
を参照してください。Takoform Core はその client artifact の内容を複製しません。

## takoform.com の範囲

この repository は API と common model の site source、build、deploy entrypoint を
持ちます。site が配信するのは Host API v1、publisher 中立な common model、exact な公開
schema bytes、conformance の語彙と案内、Core 自身のライブラリを使う実行例です。
publisher が公開する Form definition、family 固有の example、publisher catalog、
Host support/status、第三者の client adapter page、realized な DNS / CDN / account /
credential 状態は配信しません。架空の定義を使う Core の入門例と、publisher が配布する
Form は区別します。詳しくは [この site について](website/site.md) を読んでください。

## 開発

```console
bun install --frozen-lockfile
bun run check
```

この gate は format、source boundary、record と schema の検査、Go の static analysis、
portable tests、generic conformance、standalone build、site build を行います。公開や
Resource の mutation は行いません。

## License

MIT
