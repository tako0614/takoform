---
# Generated from spec/host-api/v2/README.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/host-api/v2/README.md
sourceLanguage: ja-JP
releaseState: unpublished
---

<div lang="ja-JP" class="specification-source">

# Takoform Host API v2

Takoformは、作者がHTTPで公開した資源の仕様を、異なるHostで同じ方法で操作するための
共通APIです。Formは資源の意味を定義し、Hostはその仕様を実装して資源を提供します。

この文書はTakoform v2の設計と責任分担を定めます。
HTTPの要求・応答は[HTTP API](/spec/host-api/v2/http)、Formの定義は[Form仕様](/spec/host-api/v2/forms)が定めます。
v2の規範本文として整備しているもので、公開・releaseの実施やHostの実装完了を示す記録ではありません。

| 読みたいこと | 文書 |
| --- | --- |
| なぜこの構成か、何を共通化するか | この概要 |
| 正確な要求・応答、状態、競合と復旧 | [HTTP API](/spec/host-api/v2/http) |
| Formの仕様をどう書くか | [Form仕様](/spec/host-api/v2/forms) |
| 作成から削除までの要求と失敗ケース | [具体例](/spec/host-api/v2/examples) |

共通の通信形式はHTTP APIに集約します。この概要の説明だけで別の応答形式を定義しません。

## 1. v1の保存とv2の独立性

v1の公開済み仕様、schema、参照URL、tag、releaseは、そのidentityと内容を保持します。
保存対象は[v1の凍結記録](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json)が定めます。v1の記述をv2の説明へ
上書きせず、v1のURLをv2へ転送しません。

Takoform自身の新しい仕様設計・案内・新規採用はv2を中心にします。v1は旧仕様を参照する
ために残し、v2の開発条件としてv1への機能追加や互換実装を要求しません。
v2が公開されるまでは、公開済みのv1と策定中のv2を案内上で区別します。

v2だけを実装するHost、クライアント、ライブラリは、v2へ適合できます。v1のpackage、
署名、Snapshot、schemaDigest、prepare手順、旧データ形式を持つ必要はありません。
第三者がv1を利用・実装し続けることを禁止する方針ではありません。

既存サービスのv1対応期間、旧資源の保持・移行、ライブラリの保守は、それぞれの製品が
決めます。共通バックエンドやv1/v2変換を選ぶ場合も、そのHostの実装判断です。
v2への適合条件や、v2仕様公開の前提にはしません。

## 2. 共通APIとFormの責任

| 所有者 | 定義すること |
| --- | --- |
| Takoform API | 操作のHTTP形式、ResourceとOperationの共通形式、競合・再試行、エラー、秘密入力の扱い |
| Form作者 | 入力・観測状態・出力、操作の意味、依存関係、InterfaceとBinding、版ごとの仕様 |
| Host | 対応する仕様の実装、利用者の認可、実行先、供給制限、状態の保存と復旧 |
| クライアント | 必要なFormとHostの選択、入力、操作結果の利用 |
| ライブラリ・Provider作者 | 対応する仕様への変換と、自分のソフトウェアの互換性 |

Takoformは、資源の全種類を分類する共通role列挙や、すべてのFormが実装する制約言語を
要求しません。Form固有の意味は、その作者が定義します。

Formの仕様とHost APIは、実装言語、ライブラリ、特定のTerraform Providerから独立します。
型付きProviderは、自分が対応するFormを実装し、他の作者や業界標準のProviderと組み合わせて
利用できます。どの作者にも共通の参加条件を適用します。

## 3. Formのidentityと公開

Formのidentityは、作者が所有する、版を固定した絶対HTTPS仕様URLです。
例えば `https://forms.publisher.example/table/1.0.0` という形です。このURLは説明用です。

- URLごとに、人間が読める規範仕様を公開します。
- 固定したURLで資源の意味を変更しません。意味が変わる場合は新しい版のURLを公開します。
- JSON Schema、機械可読な定義、コード生成用データは任意の補助物です。
- 補助物を公開する場合は対象の仕様URLを示します。文章との矛盾を暗黙に上書きしません。
- Hostやクライアントは、同じ仕様であることを名前、redirect先、URLの部分一致から推定しません。
- 仕様URLは実行可能コードやpackageの取得指示ではありません。

Form仕様には、少なくとも次を記載します。

1. 対象とする資源の意味と必要なHost API版。
2. 公開入力、秘密入力、観測状態、出力の形と意味。
3. 対応する操作と、その成功・失敗・利用可能状態の条件。
4. 資源同士の参照、所有、削除時の影響。
5. InterfaceとBindingがある場合、その通信・接続条件。
6. 不変の値、通常更新できる値、置換が必要な変更。

InterfaceとBindingは、通常はForm仕様の章として定義します。共通APIは、独立packageや
独立した版の系列を必須にしません。外部標準や再利用できる版固定仕様を参照できます。

Form仕様のHTTP公開が標準の提供方法です。packageのダウンロード、署名、透明性ログ、
publisher checkpoint、失効履歴の取り込み、Snapshotコンパイルは参加条件に含めません。
任意の配布物や供給網対策を追加しても、それを全Hostの必須条件へ昇格させません。

## 4. Hostの対応状況と提供条件

Hostは、自分が実装する正確なForm URLと対応操作を知らせます。これは作者の仕様の再配布や、
その仕様が存在することの認定ではありません。

次の三つを区別します。

- 作者が仕様を公開していること。
- Hostがその仕様を技術的に実装していること。
- ある利用者が、その時点の提供条件で資源を利用できること。

Offeringは、Hostが提示する実行先・制限・提供条件の選択肢です。Formのidentityを変更しません。
対応状況の取得だけで、容量、利用権限、料金の承認、実行の成功が確定することはありません。

Hostは明示的に実装したFormだけを実行します。未対応URLの要求から任意の外部サイトを取得したり、
コードを実行したりしません。実操作はpublisherサイトの可用性に依存せず、既存資源の取得・更新・
削除・復旧を行える必要があります。

## 5. HTTP操作

API識別子は `forms.takoform.com/v2`、標準API rootは
`/apis/forms.takoform.com/v2` です。

| 操作 | 経路 |
| --- | --- |
| 接続情報 | `GET /.well-known/takoform/v2` |
| Formへの対応確認 | `GET {root}/support?form=...` |
| 提供候補 | `GET {root}/offerings?form=...` |
| 作成 | `POST {root}/resources` |
| 一覧・取得 | `GET {root}/resources` / `GET {root}/resources/{uid}` |
| 更新 | `PUT {root}/resources/{uid}` |
| 削除 | `DELETE {root}/resources/{uid}` |
| 操作結果 | `GET {root}/operations/{id}` |
| 任意の事前確認 | `POST {root}/previews` |

作成入力は次の形を採用します。TypeScript表記は説明用です。
Offeringを使わない最小Hostはofferingを省き、使うHostでは明示的に選択します。
秘密入力は対応するHostとFormでだけ利用します。厳密な必須性・文法はHTTP APIに定めます。

```typescript
type CreateResource = {
  form: string;
  space: string;
  name: string;
  offering?: { id: string; revision: string };
  spec: Record<string, unknown>;
  privateInputs?: Record<string, string>;
};
```

Resourceは、UID、仕様URL、Space、名前、選択したOffering、generation、observedGeneration、
管理上のphase、公開spec、observed、output、関連Operationを持ちます。
observedとoutputの内容はForm仕様が定めます。別のResource revision軸は追加しません。

直接の作成・更新・削除を標準経路にします。previewは任意で、副作用を起こしません。
previewの結果や実行履歴を、実操作の必須引換券にしません。実操作ではその時点の入力・認可・
依存関係・供給条件・競合を検査します。

作成・更新・削除にはIdempotency-Keyを要求します。更新・削除にはgenerationの一致を要求します。
Resource UIDは一つの存在期間を識別し、削除・再作成で変わります。
古いUID向けの操作を、同名で作り直した資源へ適用しません。

通常更新ではForm URLとOfferingを変更しません。Formの版変更や実行先の移動は、その入力変更から
暗黙に推測しません。初期の共通操作には自動移行を含めません。

管理操作が成功したことと、アプリや通信先が利用可能になったことは別です。利用可能状態を示す場合は
Formが定める観測条件に従います。

アプリのbundle、image、データ等の転送は、Form仕様の公開とは別です。必要なFormだけが要求する
capabilityとし、全Hostに一律のupload機能を要求しません。

## 6. 再試行と途中失敗

受理した操作のidentityと対象資源を、再試行・再起動で変更しません。定められた保持契約の範囲では、
同じキーと同じ要求に同じ操作の結果または進行状態を返し、内容を変えた要求は副作用前に拒否します。
Hostは最低保持windowを宣言し、個々のOperationで保持期限を返します。
未完了・副作用不明の操作は期限だけで捨てません。window後の無条件再送を安全と約束しません。

Hostは、送信前、結果確定済み、送信した可能性があり結果不明、を区別できるようにします。
具体的なDB、記録形式、実行キュー、leaseの実装は指定しません。

結果不明の操作を別名・別IDで作り直しません。元の操作の結果を照合し、実行先に安全な再送機構が
ある場合だけそれを利用します。timeout、経過時間、単発の404だけで副作用なしと決めません。
結果を確定できない場合は、その不確実性を呼出者へ返します。

途中まで作成した資源は、同じ操作の再開または後始末で追跡できる必要があります。
失敗を返したことだけを理由に、処理途中の資源との対応を捨てません。

## 7. 秘密入力

privateInputsは、その操作で資源へ設定する秘密値です。Form定義や通常の公開specには含めません。
Hostの認証用credentialとも別です。

- Resource、公開Operation、観測状態、出力、ログへ値を返しません。
- 再試行の記録へ平文を保存しません。秘密値の単純hashも公開しません。
- クライアントは通常の構成や公開stateへ値を複製せず、秘密を扱う入力経路を用意します。
- 必要な入力を扱えないHostは、副作用前に拒否します。値を無視して成功にしません。
- 非同期実行・再起動に必要な範囲で、Host内部の期限付き暗号化保存を許します。
- Host内部の一時保存と、アプリが設定済みの秘密を保持することを区別します。

具体的な暗号方式、DB構成、保持時間、値の上限、鍵管理、backupはHostの実装・運用が所有します。
Takoserver向けに検討した60分等の値は、Takoform共通APIの必須値へ持ち込みません。

入力待ちと、すでに送信された可能性がある操作を区別します。秘密の再送によって新しい操作や
二重作成を起こしません。秘密の補給は元Operation専用のPUTで行い、元の値と一致した場合だけ
同じ操作を継続します。照合不能や送信結果不明を、再入力だけで成功に変えません。

## 8. 適合と公開

共通APIへの適合と、あるFormへの適合を分けます。特定のSDKやverifierの利用を合格条件にしません。
Formの機械定義が任意でも、入力・出力・関係・操作の意味の検証は省略できません。

共通APIでは、少なくとも通常の作成・取得・更新・削除、認可、競合、再試行、途中失敗、秘密の
非公開性を、実装に依存しない要求と期待結果で定義します。Formごとの意味は、その作者の規範仕様と
例・適合ケースで確かめます。publisherサイトを取得しないHostも適合できます。

v2を正式公開する前に、HTTP要求・応答の一式と例を揃えて独立レビューします。
HostやProviderの完成を仕様公開の必須条件にはしません。ただし仕様を一意に実装できるかは、
要求・応答の往復例と失敗時のケースで確認します。

正式公開時はv2の規範文書と共通wireを固定します。その後の意味の変更は新しいAPI majorで扱い、
画面構成、案内文、非規範の解説、SDK・Providerの更新とは分けます。
Form仕様は各作者のサイトに置き、Takoformのサイトは共通概念とAPI仕様を扱います。

## 9. 仕様の正本と公開

URLの完全一致、最小Host、Offeringの選択、Resource/Operationの形式、期限付き再送、
秘密補給、Form作者の記述項目を、このディレクトリの規範文書で定義します。
正本はこのREADME、`http.md`、`forms.md`の三つです。`examples.md`は非規範の解説であり、
例だけで新しい必須条件を追加しません。

署名を必須にしない代わりに、仕様の作者確認と手元で実装する内容の確認はHost運用者が行います。
URLだけでは過去のbytesや供給元の暗号的証明を得られません。必要な実装者は、版ごとの保存、
差分確認、任意の署名などを使えますが、Takoform全体への参加条件にはしません。

正式公開時に規範本文を固定します。以後、意味が変わる修正は別のAPI majorです。
解説やサイトの表示は規範本文とは分離して更新します。
release、HTTP公開、Host/Provider実装の適合宣言は、それぞれ実施した証拠で判断します。
公開後も独立した文書セットの版系列は作らず、API majorとForm URLの版を意味の変更単位にします。
SDKとProviderは独立したソフトウェアのversionで更新できます。


</div>
