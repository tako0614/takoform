# Host API v2 — HTTP API

この文書はTakoform Host API v2の要求・応答、状態、競合と再試行を定める規範です。
設計の理由は[概要](README.md)、Formの記述は[Form仕様](forms.md)、
要求の往復は[具体例](examples.md)を参照してください。
「必須」「禁止」を適合条件、「できる」を実装上の選択として使います。

公開・実装済みかどうかは、仕様の内容とは別に公開記録と各Hostの対応状況で確認します。

## 1. 範囲と共通形式

API識別子は `forms.takoform.com/v2`。標準rootは `/apis/forms.takoform.com/v2` です。
最小Hostは、接続情報、対応確認、Resourceの作成・一覧・取得・更新・削除、Operation取得を
実装します。Offering、preview、秘密入力は個別の任意capabilityです。
Form package、署名、SDK、実装言語、実行キュー、特定のDBは要求しません。

公開通信はHTTPSを使います。HTTPの意味は[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110)、
JSONは[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)に従います。
成功bodyは `application/json`、エラーは `application/problem+json` です。
認証済み応答と秘密を含む要求の応答には `Cache-Control: no-store` を付けます。
HTTP redirectで別originへcredentialを転送してはいけません。

- JSONはUTF-8。重複object key、不正なUnicode、非有限数を拒否します。
- この文書の整数は `0..9007199254740991`。上限に達したcounterを巻き戻しません。
- `id`、`uid`、`space`、`name` は `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`。
  大文字小文字を区別します。URI内では一つのpath segmentとして扱います。
- 日時はUTCのRFC 3339文字列、末尾は `Z`。例 `2026-10-04T12:00:00Z`。
- Form URLはASCIIで直列化した絶対HTTPS URL。userinfo、query、fragmentは禁止。
  空のhostは禁止。非ASCII文字は作者がURLに符号化します。完全な文字列一致で比較し、
  redirect、大小文字変換、末尾slash補完等で同一視しません。
- 共通要求の未知field、未知query、重複queryを `400 invalid_request` で拒否します。
  `spec` 内の未知fieldはFormの規定に従います。応答の未知fieldは読み飛ばせますが、
  未知の状態・操作を成功と解釈しません。拡張でこの版の必須動作を変えません。
- 本文で省略可能と書いたfieldだけを省略できます。省略と `null` は別です。
  以下のTypeScript表記は説明用であり、TypeScriptを要求しません。

## 2. 接続情報と認可

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

`baseUrl` は末尾slashのない同一originの絶対HTTPS URL。pathは標準rootを推奨しますが、
Hostが別prefixに配置できます。クライアントはこの値を使い、仕様URLをAPI rootにしません。
両 `documentation` は絶対HTTPS URLです。`schemes` は空でない文字列配列で、HTTP認証方式
（例 `Bearer`）を宣言します。ローカル管理境界で認証を置かないHostだけは `None` を宣言できます。
`None` をインターネット公開の書込許可と取り違えず、Host運用者が到達範囲を制限します。
共通APIはアカウント作成、login、credential発行、role階層、課金契約を規定しません。

limitsの各値は正の整数です。capability、認証方式、limitはHostの現在の条件であり、
Formの意味を変更しません。縮小しても、受理済みOperationの保持約束を短縮しません。

Hostは以降のすべての要求で認証・認可します。Resourceの所有境界とSpaceへの許可を照合し、
URL、名前、Form、Offering、別Resourceへの参照は権限を与える根拠にしません。
Operationと秘密再送も、対象Resourceと同等以上の認可を必要とします。
別利用者のOperationをIdempotency-Keyで取得できてはいけません。

SpaceはHost内の管理上の区画です。単一所有者Hostは一つだけ公開できます。
Spaceを作るAPIや複数利用者の収容は最小Hostの要件ではありません。
同じSpaceへの参照であっても、個々の参照先の利用権限を検査します。

## 3. Form対応とOffering

`GET {root}/support?form={encodedFormUrl}` は `200` で次を返します。
query `form` は必須です。返すURLはdecode後の要求と完全一致します。

```typescript
type Support = {
  form: string;
  supported: boolean;
  operations: ("create" | "read" | "update" | "delete")[];
  privateInputs: boolean;
};
```

未対応なら `supported:false`、空のoperations、`privateInputs:false`。
対応を主張する場合はFormの必須操作すべてを実装します。部分実装を対応済みにしません。
必須の秘密入力を扱えない場合も、そのFormを対応済みとは宣言しません。
この応答は容量や利用許可の予約ではなく、技術的な対応状況です。
Hostは要求されたForm URLを自動取得・実行せず、自身が明示的に実装した契約に照合します。
publisherが停止していても、既存資源の操作は可能である必要があります。

Offeringを使わないHostでは `capabilities.offerings:false` とし、作成入力からも省きます。
これ自体は無料という意味ではありません。認証・利用契約はHostの案内で示します。
Offeringを使うHostは `true` とし、すべての作成で明示的な選択を必要とします。
提供条件の違う選択肢を、無指定時に勝手に選んではいけません。

`GET {root}/offerings?form=...&space=...` は権限内の候補をページ形式で返します。
`form` と `space` は必須。利用できる候補がなければ空一覧です。

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

## 4. Resource

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
name、space、form、選択済みOfferingは同じUIDの間、不変です。
Offerings無効のHostでは `offering` はありません。有効なら作成時の選択を保持します。

generationは1から始まり、新しい更新・削除の受理ごとに1だけ増えます。失敗しても戻しません。
observedGenerationは最後に適合したと確認できたgeneration、未確認なら0です。
観測が古いときに現在のgenerationへ進めてはいけません。
observedAtはobserved/outputを最後に確認した日時、まだ確認していなければnullです。
失敗した確認の日時に置き換えて鮮度を偽りません。部分的な観測時刻が必要なFormは
observed内に個別の時刻を定義できます。
`observed` と `output` の形、利用可能状態の判定はFormが決めます。
管理操作の完了は、アプリや外部通信先のreadyを意味しません。
`phase:idle` は最後の操作が成功して実行中操作がない意味であり、readyの代用ではありません。
`lastOperation` は最後に受理したOperation ID。履歴の保持期間後には取得できない場合があります。

### 作成

`POST {root}/resources`。必須headerは `Idempotency-Key`。

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
受理時にUID、名前の占有、generation 1、Operationを耐久的に確定してから実行先を変更します。
同名の資源があれば `409 name_conflict`。既存資源を置き換えません。
`phase:pending`、未観測の値はFormが定める空・未確定の形で返します。

### 取得と一覧

`GET {root}/resources/{uid}` は `200 Resource`。管理記録と最後に確認した観測を返します。
GETのたびに外部資源へ再照会することは共通の必須要件ではありません。
Hostは読み取り専用で観測を更新できますが、作成・更新・削除のOperationを開始しません。
Formが鮮度を追加要件にする場合は、それにも従います。クライアントはobservedAtと
observedGenerationを確認し、取得に成功した時刻を外部の最終確認時刻と取り違えません。
Resourceがなければ404。削除完了のtombstoneを保有する間は410でも構いません。
404/410は管理記録の応答であり、不明な外部副作用が存在しない証明にはなりません。

`GET {root}/resources` は可視なResourceのページです。任意filterは `space`、`name`、
`form`（すべて完全一致）。複数filterはANDです。権限外の資源を件数やcursorで漏らしません。

### 更新

`PUT {root}/resources/{uid}`。必須headerは `Idempotency-Key` と
`Takoform-Expected-Generation: <現在のgenerationの10進整数>`。
bodyは `{ "spec": {...}, "privateInputs"?: {...} }`。
specは全体置換であり、merge patchではありません。Formが省略を許した値の意味もFormに従います。
秘密入力の省略は秘密の削除ではなく、既設定値を維持します。
秘密の削除・rotationはFormが明記した公開入力または秘密入力の操作として記述します。

存在しないUIDを作成しません。同時に受理できる変更はUIDごとに一つだけです。
未完了操作があれば `409 resource_busy`、generation不一致なら `409 generation_conflict`。
同じspecでも新しいキーなら新しい更新です。最適化のためOperationを省略しません。
Form/Offeringの移行や置換を通常更新から推定しません。

### 削除

`DELETE {root}/resources/{uid}`。更新と同じ二つのheaderを必要とし、bodyはありません。
受理時にgenerationを増やし `phase:deleting` にします。完了まで記録と名前の占有を維持します。
Formが定める所有範囲を超えて関連資源を削除しません。参照中で削除できない場合は
`409 dependency_conflict`。無指定のcascadeやforce deleteはありません。
成功後にResourceを一覧から除き、名前を解放します。Operationは保持契約に従って残します。
別キーで削除済みUIDへ要求した場合は404/410。元キーの再送は元Operationを返します。

## 5. Operationと応答

作成・更新・削除は、受理したすべての操作に同じOperation形式を使います。
未完了は `202`、すでに確定している場合は `200`。応答bodyはOperation、
`Location` は同一originの `{root}/operations/{id}` の絶対URLです。
202には正の秒数の `Retry-After` を付けます。201/204との選び分けは不要です。
受理前の拒否は§9のエラーであり、Operationを確定した成功応答と区別します。

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
GETを実行のtick、再送、復旧のtriggerにしません。バックグラウンドの進行は妨げません。

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
errorはfailedで必須、reconcilingで任意。他状態では省略します。生のbackend応答や秘密は含めません。
inputRequiredはwaiting_inputでだけ必須です。namesは要求済み秘密入力名の部分集合です。

通常遷移はqueued→running→succeeded/failed。running→reconciling、queued/running→waiting_input、
waiting_input→queued、reconciling→running/succeeded/failedも可能です。
再起動で終端を未完了へ戻したり、同じIDのaction/UID/generationを変えたりしません。
秘密待ちへ移る際は、送信したか不明な工程がないことを先に確定します。

失敗したResourceは `phase:error` として残り、最後のspec、観測、部分的な外部資源との対応を
保持します。次の明示的なPUTまたはDELETEで、同じUIDについて収束・後始末できる必要があります。
Formは既知の部分失敗に対するこの復旧動作を定義します。
不明な操作中に別Operationを受理して二重作成を起こしません。
実行先が結果照合も安全な再送も提供しない場合、Hostはreconcilingのまま理由を返し、
運用者が確定できるまで停止します。共通APIは不可能なexactly-onceを約束しません。

## 6. 再試行と保持

`Idempotency-Key` は `[A-Za-z0-9][A-Za-z0-9._:-]{15,127}`。クライアントは操作ごとに
十分な乱数を使う新しいキーを選び、同じ操作の再送では保持します。UUID文字列を利用できます。
namespaceは `(Host, API版, 認証された安定したprincipal, key)` です。
別のroute/UIDに同じキーを使い回してはいけません。Hostはcredential文字列そのものを
principalにせず、鍵更新後の同一利用者の認可・追跡方法を認証ドキュメントで示します。

要求の一致はmethod、API-relative path、全query、expected generation、JSON値で判定します。
JSONの空白・object順序だけの違いは同じです。array順序、文字列、値、fieldの省略は区別します。
数値は数学的に同じ値を等しく扱います。秘密入力も一致判定に含みますが、値や照合材料を公開しません。
Hostの照合実装、暗号、canonicalizationの保存方式は指定しません。

Hostは認証・認可後、**新しいgeneration検査や外部送信より先に**既存キーを照合します。
同じキー・同じ要求なら、元のOperationの現在値を返します。新しいOperation、UID、
nativeの別資源を作りません。内容が違えば `409 idempotency_conflict`、副作用なしです。
認可失効後の再送には結果を漏らさず403/404を返せます。

キー登録とOperation/Resourceの受理は不可分です。同時要求でも一つだけが勝ちます。
応答を失った、Hostが再起動した、実行queueが重複配送した場合も同じ対応を維持します。
native側の照合なしに「新しい名前で再作成」を行ってはいけません。

`replayWindowSeconds` は最初の受理から元要求を再送できる最低保持期間です。
Operationの `retainUntil` は少なくともその期限。未完了操作と副作用不明の記録は期限を越えて
削除しません。終端後も、終端になった時点から同じwindowの間はOperationと再送照合を保持します。
その場合retainUntilを延ばします。保持期間内の同一キー再送は期限を延ばす必須条件ではありません。

クライアントは最初に送った時刻とdiscoveryのwindowを保存します。応答未受領でも、
その時刻からwindowが経過する前に自動再送を止めます。期限後はResource/Operationを照合し、
元操作が終わったか不明なまま、同じキーまたは新しいキーで作り直してはいけません。
期限後まで同一キーが検出される保証はありません。Hostが保持中なら引き続き元結果を返します。
window外の無条件再送まで含む永久的なexactly-onceは、このAPIの保証ではありません。

v1とv2のキーは別namespaceです。複数APIが同じ資源を扱うHostは、APIをまたいでもUIDごとの
generation/実行排他を維持します。v1操作をv2キーで再送できるとは規定しません。

## 7. 秘密入力

`privateInputs` はFormで定義した名前から文字列値へのmapです。非文字列を暗黙変換しません。
不要ならfieldを省きます。秘密入力を定義しないFormは、空でないmapを拒否します。
HostとSupportの両方がprivateInputs対応を示した場合だけ送れます。
未対応なら `422 capability_required`、未知名や必須値不足は `422 invalid_spec`。

秘密をpublic spec、Resource、Operation、output、通常log、preview応答へ複製してはいけません。
エラーや診断へ値をechoせず、単純hashを公開しません。要求bodyを捕捉するtraceにも適用します。
Formが設定後に実行先へ秘密を保存することと、Hostの転送用一時保存は別です。
非同期実行や再起動に備えるHost内部の期限付き暗号化保存を許します。
暗号方式、DB、具体的TTL、鍵管理はHostの責任であり、共通のvault製品を要求しません。

一時値が期限切れ・取得不能になっても、元要求と同じ秘密であることを非公開で照合できる間は、
安全に未送信と確定した工程だけをwaiting_inputにできます。
クライアントは `PUT {root}/operations/{id}/private-inputs` に
`{ "privateInputs": { ... } }` を送ります。元要求の秘密map全体を送り、値の変更・追加・削除をしません。
このPUTは既存Operationへの入力補給であり、新しいIdempotency-Keyやgenerationを発行しません。
同じ値の補給を繰り返しても同じOperationを返し、別実行を起こしません。

Hostは認可、元のmapとの一致、Operationが非終端であることを検査します。
違う値は `409 private_inputs_conflict`、照合自体が不能なら `409 private_inputs_unverifiable`。
終端なら `409 operation_terminal`。成功は `200 Operation`。
waiting_input以外の非終端へ同じ値を再送した場合も200の現在値だけを返し、再実行しません。
元要求との非公開の照合材料は、秘密の転送用一時値とは別に、少なくとも§6の再送保持期間と
未完了Operationの間は維持します。一時値のTTLだけで照合材料も捨ててはいけません。
障害等で照合材料を失った場合は、通常の再送も補給も `409 private_inputs_unverifiable` とし、
認可済み利用者には分かっている元operationIdを返します。新しいOperationは作りません。
これは正常な期限切れではなくHostの保持保証を満たせなかった障害です。
副作用を確定できるならfailedにし、できなければreconcilingを維持して回復を待ちます。

通常のResource変更を秘密の再送として流用しません。値を変更する意図は新しい明示的更新です。

## 8. 一覧と任意機能

一覧は `{ "items": [...], "nextCursor": string | null }`。
任意query `limit` は1以上maxPageSize以下、省略時はmaxPageSize。
`cursor` はHost発行の不透明文字列。filter・Space・principalに束縛し、変更との併用は400。
順序はUID（Offeringならid）のASCII昇順。cursorは最後に返したidentityより後を指します。
同じidentityをページ送りで重複しません。途中の作成・削除はsnapshot保証の対象外です。
一覧操作中に追加され、cursorより前に並ぶ項目は、その走査では含まれない場合があります。
cursor期限切れは `409 cursor_expired` とし、先頭からの取得を案内します。

preview対応Hostは `POST {root}/previews` を実装します。

```typescript
type PreviewRequest =
  | { action: "create"; input: Create }
  | { action: "update"; uid: string; expectedGeneration: number;
      input: { spec: Record<string, unknown>; privateInputs?: Record<string, string> } }
  | { action: "delete"; uid: string; expectedGeneration: number };
type Preview = { valid: boolean; errors: { code: string; message: string }[] };
```

previewは構文・認可を検査し、入力の適否を `200 Preview` で返します。validならerrorsは空。
資源、予約、課金、Operation、秘密の永続保存を作りません。
情報収集のためのreadは可能です。結果は助言だけで、実操作のtokenや必須工程にはしません。
未対応capabilityの経路は `404 capability_unavailable`。

artifactの転送、実行コードのupload、HTTP/WebSocket等のdata planeは共通CRUDに含めません。
必要なFormが転送・接続方法と認可を定義します。Formの公開とartifactの配布を混同しません。
外部参照を使う場合も、任意URLをcredential付きで取得できる権限を意味しません。

## 9. エラー

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)のProblem Detailsを使います。
必須fieldは `type:"about:blank"`、`title`、HTTPと同じ整数の `status`、安定した `code`。
任意 `detail` は秘密を含まない説明、`operationId` は受理済みと分かる場合だけの元IDです。
unknown field/状態はクライアントが成功と推定せず扱います。HTTP層の非JSON障害もあり得ます。

| HTTP | code | 呼出者の動作 |
| --- | --- | --- |
| 400 | invalid_request | 共通形式を修正する |
| 401 | unauthenticated | Hostの方式で認証する。WWW-Authenticateを返す |
| 403 | forbidden | 権限を確認。自動再試行しない |
| 404 | not_found / capability_unavailable | identityまたは対応機能を確認する |
| 405 | method_not_allowed | Allow headerのmethodを使う |
| 409 | name_conflict / generation_conflict / resource_busy | 元Resource/Operationを取得する |
| 409 | idempotency_conflict / offering_changed / dependency_conflict | 内容を照合し、意図を決め直す |
| 409 | private_inputs_conflict / private_inputs_unverifiable / operation_terminal | §7に従う。新規操作へ自動変換しない |
| 409 | cursor_expired | 一覧を先頭から取得する |
| 410 | gone | 削除済み・保持終了。副作用なしの証明には使わない |
| 413 | request_too_large | discoveryとHostの上限を確認する |
| 415 | unsupported_media_type | application/jsonで送る |
| 422 | unsupported_form / invalid_spec / capability_required | Form仕様と対応状況を確認する |
| 428 | expected_generation_required | generation headerを付ける |
| 429 | rate_limited | Retry-Afterに従う |
| 503 | temporarily_unavailable | 元のキーを保持して§6に従う |
| 500 | internal_error | 受理済みか不明。元のキーで照合する |

Form固有のエラー理由はdetailまたはOperation.errorに書けますが、管理上の失敗分類を
変えません。503、500、ネットワーク切断、HTTP proxyの応答だけでは未受理と断定しません。
Hostの内部例外、credential、秘密値、別利用者の資源情報を返してはいけません。

## 10. 適合確認と固定

最低限、次を同じ公開APIから確認できる実装が必要です。

1. 対応Formと必須操作を正しく宣言し、未対応URLを取得せず拒否する。
2. 作成→取得→更新→削除を同じUID/世代規則で実行する。
3. 同時の同一キー、内容違い、古い世代、別principalを区別する。
4. 受理直後・外部送信直後・外部成功直後に応答喪失とHostプロセス再起動を入れ、
   同じ永続状態から照合する。インプロセスのhandle再生成だけでは代替しない。
5. 部分失敗を記録に残し、同じUIDの更新または削除で回復する。孤児を成功として隠さない。
6. 任意capabilityを宣言した場合は、それぞれの失敗・再試行・非漏洩も満たす。

共通API適合は特定のForm、実行先、SDK、Providerの完成を意味しません。
Form適合はその作者の仕様にも従って確認します。正式公開前に本文と例を独立レビューし、
規範文書の集合を固定します。正式公開後の意味変更は新しいAPI majorで行い、
文書の版番号を別途増やす方法で契約を変えません。
