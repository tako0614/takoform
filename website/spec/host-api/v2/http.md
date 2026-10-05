---
# Generated from spec/host-api/v2/http.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/host-api/v2/http.md
sourceLanguage: ja-JP
releaseState: unpublished
---

<div lang="ja-JP" class="specification-source">

# Host API v2 — HTTP API

この文書はTakoform Host API v2の要求・応答、状態、競合と再試行を定める規範です。
基本概念は[概要](/spec/host-api/v2/)、Formの記述は[Formの定義](/spec/host-api/v2/forms)、
要求の往復は[具体例](/spec/host-api/v2/examples)を参照してください。
「必須」「禁止」を適合条件、「できる」を実装上の選択として使います。

クライアントは接続情報とFormへの対応を確認し、資源の変更を要求して、返されたOperationを
取得します。具体的な値を使った操作の流れから読む場合は[具体例](/spec/host-api/v2/examples)へ進んでください。

### 経路一覧 {#endpoints}

`{root}`は接続情報の`baseUrl`です。各経路の詳細は次の表から参照できます。

| 操作 | メソッドと経路 | 実装する条件 |
| --- | --- | --- |
| [接続情報](#discovery) | `GET /.well-known/takoform/v2` | 必須 |
| [Form対応確認](#support) | `GET {root}/support` | 必須 |
| [Offering一覧](#offerings) | `GET {root}/offerings` | `capabilities.offerings:true` |
| [資源の作成](#create) | `POST {root}/resources` | 必須 |
| [資源の取得](#read) | `GET {root}/resources/{uid}` | 必須 |
| [資源の一覧](#list-resources) | `GET {root}/resources` | 必須 |
| [資源の更新](#update) | `PUT {root}/resources/{uid}` | 必須 |
| [資源の削除](#delete) | `DELETE {root}/resources/{uid}` | 必須 |
| [操作の取得](#operations) | `GET {root}/operations/{id}` | 必須 |
| [秘密入力の補給](#replenish-inputs) | `PUT {root}/operations/{id}/private-inputs` | `capabilities.privateInputs:true` |
| [事前確認](#previews) | `POST {root}/previews` | `capabilities.previews:true` |

## 1. 範囲と共通形式 {#common-format}

API識別子は `forms.takoform.com/v2`です。標準のAPIルートは `/apis/forms.takoform.com/v2` です。
最小Hostは、接続情報、対応確認、Resourceの作成・一覧・取得・更新・削除、Operation取得を
実装します。Offering、preview、秘密入力はそれぞれ任意の機能です。

### 通信形式

公開通信はHTTPSを使います。HTTPの意味は[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110)、
JSONは[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)に従います。
成功応答の本文は `application/json`、エラーは `application/problem+json` です。
認証済み応答と秘密を含む要求の応答には `Cache-Control: no-store` を付けます。
HTTPリダイレクトによって別オリジンへ認証情報を転送してはいけません。

- JSONはUTF-8です。重複するオブジェクトのキー、不正なUnicode、非有限数を拒否します。
- この文書の整数は `0..9007199254740991`です。上限に達したカウンターを巻き戻しません。
- `id`、`uid`、`space`、`name` は `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`。
  大文字小文字を区別します。URI内では一つのパス区間として扱います。
- 日時はUTCのRFC 3339文字列で、末尾は `Z`です。例：`2026-10-04T12:00:00Z`。
- Form URLはASCIIで直列化した絶対HTTPS URLです。ユーザー情報、クエリ、フラグメント、
  空のホスト名は禁止です。非ASCII文字は作者がURLに符号化します。完全な文字列一致で比較し、
  転送先への置換、大小文字変換、末尾スラッシュの補完などで同一視しません。
- 共通要求の未知のフィールド、未知・重複するクエリを `400 invalid_request` で拒否します。
  `spec` 内の未知のフィールドはFormの規定に従います。応答の未知のフィールドは読み飛ばせますが、
  未知の状態・操作を成功と解釈しません。拡張でこの版の必須動作を変えません。
- 本文で省略可能と書いたフィールドだけを省略できます。省略と `null` は別です。
  以下のTypeScript表記は説明用であり、TypeScriptを要求しません。

### 変更要求のヘッダー

| ヘッダー | 対象 | 用途 |
| --- | --- | --- |
| `Content-Type: application/json` | JSON本文を送る要求 | 本文の形式 |
| `Idempotency-Key` | 作成・更新・削除 | 同じ要求の再送を識別する。文法と保持期間は[§6](#retry) |
| `Takoform-Expected-Generation` | 更新・削除 | 変更対象の現在の世代を10進整数で指定する |

認証情報の渡し方はHostが宣言する認証方式に従います。
秘密入力の補給は既存Operationに対する操作であり、新しい再送キーや世代を使いません。

## 2. 接続情報と認可 {#discovery}

`GET /.well-known/takoform/v2` は未認証で接続情報だけを返します。
資源、利用者、秘密の一覧を含めません。

```typescript
type Discovery = {
  api: "forms.takoform.com/v2";
  baseUrl: string;
  documentation: string;
  authentication: { schemes: string[]; documentation: string };
  capabilities: { offerings: boolean; previews: boolean; privateInputs: boolean };
  limits: { maxRequestBytes: number; maxPageSize: number; replayWindowSeconds: number };
};
```

`baseUrl` はASCIIで直列化した、接続情報と同一オリジンの絶対HTTPS URLです。
ユーザー情報、クエリ、フラグメント、末尾のスラッシュを含めません。
パスは標準のAPIルートを推奨しますが、Hostは別のパスやオリジン直下へ配置できます。
オリジン直下の場合は `https://host.example` のようにパスを省きます。
各経路はこの文字列に、経路表の先頭 `/` を含む接尾辞をそのまま連結して作ります。
先頭 `/` をオリジン相対パスとして解決したり、baseUrlの最終パス区間を置き換えたりしません。
クエリを使う操作では、この連結後にクエリ名と符号化した値を追加します。
クライアントはこの値を使い、Formの仕様URLをAPIの接続先にしません。

| `baseUrl` | Resource作成先 |
| --- | --- |
| `https://host.example/apis/forms.takoform.com/v2` | `https://host.example/apis/forms.takoform.com/v2/resources` |
| `https://host.example/custom/api` | `https://host.example/custom/api/resources` |
| `https://host.example` | `https://host.example/resources` |

`https://host.example/api?tenant=x`、`https://host.example/api#v2`、
`https://user@host.example/api`、`https://host.example/api/` はbaseUrlとして不正です。
不正な接続情報を受け取ったクライアントは、値を補正して認証情報付きの要求を送らず停止します。

両 `documentation` は絶対HTTPS URLです。`schemes` は空でない文字列配列で、HTTP認証方式
（例 `Bearer`）を宣言します。ローカル管理境界で認証を置かないHostだけは `None` を宣言できます。
`None` をインターネット公開の書込許可と取り違えず、Host運用者が到達範囲を制限します。
共通APIはアカウント作成、ログイン、認証情報の発行、権限の階層、課金契約を規定しません。

`limits`の各値は正の整数です。対応機能、認証方式、上限はHostの現在の条件であり、
Formの意味を変更しません。縮小しても、受理済みOperationの保持約束を短縮しません。

Hostは以降のすべての要求で認証・認可します。Resourceの所有境界とSpaceへの許可を照合し、
URL、名前、Form、Offering、別Resourceへの参照は権限を与える根拠にしません。
Operationと秘密再送も、対象Resourceと同等以上の認可を必要とします。
別利用者のOperationをIdempotency-Keyで取得できてはいけません。

SpaceはHost内の管理上の区画です。単一所有者Hostは一つだけ公開できます。
Spaceを作るAPIや複数利用者の収容は最小Hostの要件ではありません。
同じSpaceへの参照であっても、個々の参照先の利用権限を検査します。

## 3. Form対応とOffering {#support}

### Formへの対応を確認する

`GET {root}/support?form={encodedFormUrl}` は `200` で次を返します。
クエリの`form`は必須です。返すURLは復号したクエリ値と完全一致します。

```typescript
type Support = {
  form: string;
  supported: boolean;
  operations: ("create" | "read" | "update" | "delete")[];
  privateInputs: boolean;
};
```

未対応なら `supported:false`、空の`operations`、`privateInputs:false`を返します。
対応を主張する場合はFormの必須操作すべてを実装します。部分実装を対応済みにしません。
必須の秘密入力を扱えない場合も、そのFormを対応済みとは宣言しません。
この応答は容量や利用許可の予約ではなく、技術的な対応状況です。
Hostは要求されたForm URLを自動取得・実行せず、自身が明示的に実装した契約に照合します。
作者のサイトが停止していても、既存資源の操作は可能である必要があります。

### Offeringを選択する {#offerings}

Offeringを使わないHostでは `capabilities.offerings:false` とし、作成入力からも省きます。
これ自体は無料という意味ではありません。認証・利用契約はHostの案内で示します。
Offeringを使うHostは `true` とし、すべての作成で明示的な選択を必要とします。
提供条件の違う選択肢を、無指定時に勝手に選んではいけません。

`GET {root}/offerings?form=...&space=...` は権限内の候補をページ形式で返します。
`form` と `space` は必須です。利用できる候補がなければ空一覧です。

```typescript
type Offering = {
  id: string;
  revision: string;
  form: string;
  label: string;
  description: string;
  termsUrl?: string;
};
type OfferingSelection = { id: string; revision: string };
```

revisionはHost内の不透明な非空文字列です。Form、実行先、制限、料金・契約条件など
選択の意味が変わる場合はrevisionを変えます。`termsUrl` は絶対HTTPS URLで、リンク先の
契約変更もrevision更新の対象です。revisionの一致は供給予約でも課金の同意手続きでもありません。
新規作成時に選択のrevisionと認可を検査し、不一致を `409 offering_changed` で返します。
すでに動いている資源の料金や実行先をこのAPIで暗黙変更しません。
既存Resourceは選択時の条件と実行先への対応を保持します。Offering一覧から消えたことや
新規用revisionが変わったことだけで、そのResourceの取得・削除・既知の部分失敗の後始末を
拒否してはいけません。更新時の利用権限や供給制限は検査しますが、現在の新規Offeringへ
黙って乗り換えません。

## 4. Resource {#resources}

ResourceはHostが管理する一つの資源の記録です。実行先の資源が一時的に不在でも、
管理記録を失ったことにはしません。共通形式は次のとおりです。

```typescript
type Resource = {
  uid: string;
  form: string;
  space: string;
  name: string;
  offering?: OfferingSelection;
  generation: number;
  observedGeneration: number;
  observedAt: string | null;
  phase: "pending" | "idle" | "deleting" | "error";
  spec: Record<string, unknown>;
  observed: Record<string, unknown>;
  output: Record<string, unknown>;
  lastOperation: string;
};
```

UIDはHost全体で一意で、削除後も再利用しません。`(space,name)` はFormをまたいで一意です。
`name`、`space`、`form`、選択済みOfferingは同じUIDの間、不変です。
Offeringが無効のHostでは `offering` はありません。有効なら作成時の選択を保持します。

generationは1から始まり、新しい更新・削除の受理ごとに1だけ増えます。失敗しても戻しません。
observedGenerationは最後に適合したと確認できたgeneration、未確認なら0です。
観測が古いときに現在のgenerationへ進めてはいけません。
observedAtはobserved/outputを最後に確認した日時、まだ確認していなければnullです。
失敗した確認の日時に置き換えて鮮度を偽りません。部分的な観測時刻が必要なFormは
observed内に個別の時刻を定義できます。
`observed` と `output` の形、利用可能状態の判定はFormが決めます。
管理操作の完了は、アプリや外部通信先が利用可能になったことを意味しません。
`phase:idle` は最後の操作が成功して実行中操作がない意味であり、利用可能状態の代用ではありません。
`lastOperation` は最後に受理したOperation IDです。履歴の保持期間後には取得できない場合があります。

### 作成 {#create}

`POST {root}/resources`を使います。必須ヘッダーは `Idempotency-Key`です。

```typescript
type Create = {
  form: string;
  space: string;
  name: string;
  offering?: OfferingSelection;
  spec: Record<string, unknown>;
  privateInputs?: Record<string, string>;
};
```

副作用前に構文、Form、認可、Offering、入力、参照を検査します。
受理時にUID、名前の占有、generation 1、Operationを永続化してから実行先を変更します。
同名の資源があれば `409 name_conflict`を返します。既存資源を置き換えません。
`phase:pending`、未観測の値はFormが定める空・未確定の形で返します。

### 取得 {#read}

`GET {root}/resources/{uid}` は `200 Resource`を返します。管理記録と最後に確認した観測を返します。
GETのたびに外部資源へ再照会することは共通の必須要件ではありません。
Hostは読み取り専用で観測を更新できますが、作成・更新・削除のOperationを開始しません。
Formが鮮度を追加要件にする場合は、それにも従います。クライアントはobservedAtと
observedGenerationを確認し、取得に成功した時刻を外部の最終確認時刻と取り違えません。
Resourceがなければ404を返します。削除済みであることを記録している間は410でも構いません。
404/410は管理記録の応答であり、不明な外部副作用が存在しない証明にはなりません。

### 一覧 {#list-resources}

`GET {root}/resources` は、利用者が取得できるResourceを[ページ形式](#pagination)で返します。
絞り込みには`space`、`name`、`form`を任意で指定できます。値はすべて完全一致で比較し、
複数の条件を指定した場合はすべてを満たす項目を返します。
権限外の資源を件数やカーソルで漏らしません。

### 更新 {#update}

`PUT {root}/resources/{uid}`を使います。必須ヘッダーは `Idempotency-Key` と
`Takoform-Expected-Generation: <現在のgenerationの10進整数>`。
本文は`spec`と、省略可能な`privateInputs`を持つオブジェクトです。
`spec`は全体置換であり、差分の追加ではありません。省略を許した値の意味もFormに従います。
秘密入力の省略は秘密の削除ではなく、既設定値を維持します。
秘密の削除・更新はFormが明記した公開入力または秘密入力の操作として記述します。

存在しないUIDを作成しません。同時に受理できる変更はUIDごとに一つだけです。
未完了操作があれば `409 resource_busy`、generation不一致なら `409 generation_conflict`。
同じspecでも新しいキーなら新しい更新です。最適化のためOperationを省略しません。
Form/Offeringの移行や置換を通常更新から推定しません。

### 削除 {#delete}

`DELETE {root}/resources/{uid}`を使います。更新と同じ二つのヘッダーを必要とし、本文はありません。
受理時にgenerationを増やし `phase:deleting` にします。完了まで記録と名前の占有を維持します。
Formが定める所有範囲を超えて関連資源を削除しません。参照中で削除できない場合は
`409 dependency_conflict`を返します。暗黙の連鎖削除や強制削除はありません。
成功後にResourceを一覧から除き、名前を解放します。Operationは保持契約に従って残します。
別キーで削除済みUIDへ要求した場合は404/410を返します。元キーの再送は元Operationを返します。

## 5. Operationと応答 {#operations}

作成・更新・削除は、受理したすべての操作に同じOperation形式を使います。
未完了なら`202`、すでに結果が確定している場合は`200`を返します。応答本文はOperation、
`Location` は同一オリジンの `{root}/operations/{id}` の絶対URLです。
202には正の秒数の `Retry-After` を付けます。201や204は使いません。
受理前の拒否は[§9](#errors)のエラーであり、Operationを返す応答と区別します。

```typescript
type Operation = {
  id: string;
  resourceUid: string;
  action: "create" | "update" | "delete";
  generation: number;
  status: "queued" | "running" | "waiting_input" | "reconciling" | "succeeded" | "failed";
  effect: "none" | "unknown" | "partial" | "complete";
  createdAt: string;
  updatedAt: string;
  retainUntil: string;
  error?: { code: string; message: string };
  inputRequired?: { names: string[]; reason: "expired" | "unavailable" };
};
```

`GET {root}/operations/{id}` は常に `200 Operation`、または404/410です。
GETを契機に実行・再送・復旧を開始しません。バックグラウンドの進行は妨げません。

| status | 意味と次の動作 |
| --- | --- |
| queued | 未送信。実行待ち |
| running | 実行中。再送で新しい操作を起こさない |
| waiting_input | 未送信の工程に秘密入力が必要。§7の再送を待つ |
| reconciling | 送信した可能性があるが結果未確定。元の実行先・識別子で照合する |
| succeeded | Formが定めた管理操作が完了。終端 |
| failed | 操作は終了。effectで副作用の残りを明示する。終端 |

effectはFormが管理する資源・データへの効果です。HostのResource/Operation管理記録、
名前の占有、generation更新は含めません。管理対象がHostと同じDB内にあってもこの区別をします。
`effect:none` は管理対象への副作用なしと確定、`unknown` は未確定、`partial` は追跡可能な一部変更、
`complete` は要求した変更の完了です。timeoutだけを理由にnoneにしません。
succeededはcomplete、failedはnoneまたはpartialです。unknownは終端にせずreconcilingで保持します。
`error`は`failed`で必須、`reconciling`で任意です。他の状態では省略します。
実行先からの生の応答や秘密は含めません。
`inputRequired`は`waiting_input`でだけ必須です。`names`は要求済み秘密入力名の部分集合です。

通常の状態遷移は次のとおりです。

| 現在の状態 | 遷移できる状態 |
| --- | --- |
| queued | running、waiting_input |
| running | succeeded、failed、reconciling、waiting_input |
| waiting_input | queued |
| reconciling | running、succeeded、failed |
| succeeded、failed | 終端のため遷移しない |

再起動で終端を未完了へ戻したり、同じIDのaction/UID/generationを変えたりしません。
秘密待ちへ移る際は、送信したか不明な工程がないことを先に確定します。

失敗したResourceは `phase:error` として残り、最後のspec、観測、部分的な外部資源との対応を
保持します。次の明示的なPUTまたはDELETEで、同じUIDについて収束・後始末できる必要があります。
Formは既知の部分失敗に対するこの復旧動作を定義します。
不明な操作中に別Operationを受理して二重作成を起こしません。
実行先が結果照合も安全な再送も提供しない場合、Hostはreconcilingのまま理由を返し、
運用者が確定できるまで停止します。結果を確かめられない実行先についてまで、一度だけの実行を保証しません。

## 6. 再試行と保持 {#retry}

`Idempotency-Key`の文法は `[A-Za-z0-9][A-Za-z0-9._:-]{15,127}`です。クライアントは操作ごとに
十分な乱数を使う新しいキーを選び、同じ操作の再送では保持します。UUID文字列を利用できます。
キーを識別する範囲は`(Host, API版, 認証された安定した利用主体, key)`です。
ここで利用主体（principal）は認証情報そのものではなく、その情報によって識別される利用者等を指します。
別の経路やUIDに同じキーを使い回してはいけません。Hostは鍵を更新した後も同じ利用主体を
どう認可・追跡するかを、認証ドキュメントで示します。

要求の一致はHTTPメソッド、APIルートからの相対パス、全クエリ、指定した世代、JSON値で判定します。
JSONの空白・オブジェクトのキー順序だけの違いは同じです。配列の順序、文字列、値、フィールドの省略は区別します。
数値は数学的に同じ値を等しく扱います。秘密入力も一致判定に含みますが、値や照合材料を公開しません。
Hostが照合に使う実装、暗号、正規化した値の保存方式は指定しません。

Hostは認証・認可後、**新しいgeneration検査や外部送信より先に**既存キーを照合します。
同じキー・同じ要求なら、元のOperationの現在値を返します。新しいOperation、UID、
実行先の別資源を作りません。内容が違えば `409 idempotency_conflict`を返し、副作用を起こしません。
認可失効後の再送には結果を漏らさず403/404を返せます。

キー登録とOperation/Resourceの受理は不可分です。同時要求でも一つだけが勝ちます。
応答を失った、Hostが再起動した、実行キューが重複配送した場合も同じ対応を維持します。
実行先との照合なしに「新しい名前で再作成」を行ってはいけません。

`replayWindowSeconds` は最初の受理から元要求を再送できる最低保持期間です。
Operationの `retainUntil` は少なくともその期限です。未完了操作と副作用不明の記録は期限を越えて
削除しません。終端後も、終端になった時点から同じ長さの期間はOperationと再送照合を保持します。
その場合は`retainUntil`を延ばします。保持期間内に同じキーが再送されても、
それだけを理由に期限を延ばす必要はありません。

クライアントは最初に送った時刻と接続情報にある保持期間を保存します。応答未受領でも、
その時刻から保持期間が経過する前に自動再送を止めます。期限後はResource/Operationを照合し、
元操作が終わったか不明なまま、同じキーまたは新しいキーで作り直してはいけません。
期限後まで同一キーが検出される保証はありません。Hostが保持中なら引き続き元結果を返します。
保持期間外の無条件再送を含め、永久に一度だけ実行されることまで保証するものではありません。

複数APIが同じ資源を扱うHostは、APIをまたいでもUIDごとの世代と実行の排他制御を維持します。

## 7. 秘密入力 {#private-inputs}

`privateInputs` はFormで定義した名前をキー、文字列を値とするオブジェクトです。
非文字列を暗黙変換しません。不要ならフィールドを省きます。
秘密入力を定義しないFormは、空でないオブジェクトを拒否します。
HostとSupportの両方がprivateInputs対応を示した場合だけ送れます。
未対応なら `422 capability_required`、未知名や必須値不足なら `422 invalid_spec`を返します。

秘密を公開spec、Resource、Operation、output、通常のログ、preview応答へ複製してはいけません。
エラーや診断へ値を返さず、単純なハッシュを公開しません。要求本文を記録する追跡機能にも適用します。
Formが設定後に実行先へ秘密を保存することと、Hostの転送用一時保存は別です。
非同期実行や再起動に備えるHost内部の期限付き暗号化保存を許します。
暗号方式、DB、具体的な有効期間、鍵管理はHostの責任であり、共通の秘密管理製品を要求しません。

### 同じOperationへ秘密を補給する {#replenish-inputs}

一時値が期限切れ・取得不能になっても、元要求と同じ秘密であることを非公開で照合できる間は、
安全に未送信と確定した工程だけをwaiting_inputにできます。
クライアントは `PUT {root}/operations/{id}/private-inputs` に
`{ "privateInputs": { ... } }` を送ります。元要求の秘密入力全体を送り、値の変更・追加・削除をしません。
このPUTは既存Operationへの入力補給であり、新しいIdempotency-Keyやgenerationを発行しません。
同じ値の補給を繰り返しても同じOperationを返し、別実行を起こしません。

Hostは認可、元の秘密入力全体との一致、Operationが非終端であることを検査します。
違う値には `409 private_inputs_conflict`、照合自体が不能なら `409 private_inputs_unverifiable`を返します。
終端なら `409 operation_terminal`、成功なら `200 Operation`を返します。
waiting_input以外の非終端へ同じ値を再送した場合も200の現在値だけを返し、再実行しません。
元要求との非公開の照合材料は、秘密の転送用一時値とは別に、少なくとも§6の再送保持期間と
未完了Operationの間は維持します。一時値の有効期間だけで照合材料も捨ててはいけません。
障害等で照合材料を失った場合は、通常の再送も補給も `409 private_inputs_unverifiable` とし、
認可済み利用者には分かっている元operationIdを返します。新しいOperationは作りません。
これは正常な期限切れではなくHostの保持保証を満たせなかった障害です。
副作用を確定できるならfailedにし、できなければreconcilingを維持して回復を待ちます。

通常のResource変更を秘密の再送として流用しません。値を変更する意図は新しい明示的更新です。

## 8. 一覧と任意機能 {#optional-features}

### ページ形式 {#pagination}

一覧は`items`（項目の配列）と`nextCursor`（次のページのカーソル、または`null`）を返します。
`nextCursor:null`なら次のページはありません。

| クエリ | 指定する値 | 省略時 |
| --- | --- | --- |
| `limit` | 1以上`maxPageSize`以下の整数 | `maxPageSize` |
| `cursor` | 前の応答にある`nextCursor`の文字列 | 先頭から取得 |

カーソルはHostが発行し、絞り込み条件・Space・利用主体に結び付けます。
クライアントがそれらの条件を変えて同じカーソルを送った場合は400を返します。
項目はUID（Offeringなら`id`）のASCII昇順で返し、カーソルは最後の識別子より後を指します。
同じ識別子をページ送りで重複しません。

一覧の取得中に作成・削除が起きた場合、取得開始時点の全項目を固定して返す保証はありません。
途中で追加され、カーソルより前に並ぶ項目は、その取得では含まれない場合があります。
カーソルの期限切れには `409 cursor_expired`を返し、先頭からの取得を案内します。

### 事前確認 {#previews}

preview対応Hostは `POST {root}/previews` を実装します。

```typescript
type PreviewRequest =
  | { action: "create"; input: Create }
  | { action: "update"; uid: string; expectedGeneration: number;
      input: { spec: Record<string, unknown>; privateInputs?: Record<string, string> } }
  | { action: "delete"; uid: string; expectedGeneration: number };
type Preview = { valid: boolean; errors: { code: string; message: string }[] };
```

previewは構文・認可を検査し、入力の適否を `200 Preview` で返します。
`valid:true`なら`errors`は空の配列です。
資源、予約、課金、Operation、秘密の永続保存を作りません。
情報収集のための読み取りは可能です。結果は助言だけで、実操作の引換券や必須工程にはしません。
未対応の任意機能の経路は `404 capability_unavailable`を返します。

### データやコードの転送

データの転送、実行コードのアップロード、HTTP/WebSocketなどの実行時の通信は共通CRUDに含めません。
必要なFormが転送・接続方法と認可を定義します。Form仕様の公開と、アプリのコードやデータの配布は別です。
外部参照を使う場合も、任意URLを認証情報付きで取得できる権限を意味しません。

## 9. エラー {#errors}

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)のProblem Detailsを使います。
必須フィールドは`type:"about:blank"`、`title`、HTTPと同じ整数の`status`、安定した`code`です。
省略可能な`detail`は秘密を含まない説明、`operationId`は受理済みと分かる場合だけの元IDです。
未知のフィールド・状態から成功を推定してはいけません。HTTP層ではJSONでない障害応答もあり得ます。

| HTTP | code | 呼出者の動作 |
| --- | --- | --- |
| 400 | invalid_request | 共通形式を修正する |
| 401 | unauthenticated | Hostの方式で認証する。HostはWWW-Authenticateを返す |
| 403 | forbidden | 権限を確認。自動再試行しない |
| 404 | not_found / capability_unavailable | 識別子または対応機能を確認する |
| 405 | method_not_allowed | Hostが返すAllowヘッダーのメソッドを使う |
| 409 | name_conflict / generation_conflict / resource_busy | 元Resource/Operationを取得する |
| 409 | idempotency_conflict / offering_changed / dependency_conflict | 内容を照合し、意図を決め直す |
| 409 | private_inputs_conflict / private_inputs_unverifiable / operation_terminal | §7に従う。新規操作へ自動変換しない |
| 409 | cursor_expired | 一覧を先頭から取得する |
| 410 | gone | 削除済み・保持終了。副作用なしの証明には使わない |
| 413 | request_too_large | 接続情報とHostの上限を確認する |
| 415 | unsupported_media_type | application/jsonで送る |
| 422 | unsupported_form / invalid_spec / capability_required | Form仕様と対応状況を確認する |
| 428 | expected_generation_required | Takoform-Expected-Generationヘッダーを付ける |
| 429 | rate_limited | Hostが返すRetry-Afterに従う |
| 503 | temporarily_unavailable | 元のキーを保持して§6に従う |
| 500 | internal_error | 受理済みか不明。元のキーで照合する |

Form固有のエラー理由はdetailまたはOperation.errorに書けますが、管理上の失敗分類を
変えません。503、500、ネットワーク切断、HTTPプロキシの応答だけでは未受理と断定しません。
Hostの内部例外、認証情報、秘密値、別利用者の資源情報を返してはいけません。

## 10. 適合確認 {#conformance}

最低限、次を同じ公開APIから確認できる実装が必要です。

1. 対応Formと必須操作を正しく宣言し、未対応URLを取得せず拒否する。
2. 作成→取得→更新→削除を同じUID/世代規則で実行する。
3. 同時の同一キー、内容違い、古い世代、別の利用主体を区別する。
4. 受理直後・外部送信直後・外部成功直後に応答喪失とHostプロセス再起動を入れ、
   同じ永続状態から照合する。同じプロセス内で参照を作り直すだけでは代替しない。
5. 部分失敗を記録に残し、同じUIDの更新または削除で回復する。孤児を成功として隠さない。
6. 任意機能を宣言した場合は、それぞれの失敗・再試行・秘密を漏らさない条件も満たす。

共通API適合は特定のForm、実行先、SDK、Providerの完成を意味しません。
Form適合はその作者の仕様にも従って確認します。


</div>
