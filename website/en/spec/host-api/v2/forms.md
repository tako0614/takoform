---
# Generated from spec/host-api/v2/forms.md by scripts/site.mjs. Edit the specification, not this page.
normative: true
canonicalSource: spec/host-api/v2/forms.md
sourceLanguage: ja-JP
releaseState: unpublished
---

<div lang="ja-JP" class="specification-source">

# Form仕様の定義と公開

この文書はTakoform v2におけるFormの識別、版、記載事項を定める規範です。
Form作者は資源の意味を定義し、Hostはその仕様を実装します。
要求・応答の共通形式は[HTTP API](/en/spec/host-api/v2/http)が定めます。

以下の例は説明用に作った架空のものです。公開済みの Takoform Form、ecosystem の推奨、または Host の対応表明ではありません。

## Form 作者が公開するもの

Form は、ある種類の資源について、その版での意味を定める仕様です。作者が管理する絶対 HTTPS URL に、人が読める規範仕様を公開します。Host とクライアントは、その URL の文字列そのものを Form の identity として使います。URL は仕様を識別するものであり、コードや package の取得指示ではありません。

仕様は Markdown、HTML など、人が読める形式で構いません。独立した Host 実装同士が互換な入力検証と結果を実現できるよう、挙動を具体的に書きます。JSON Schema、例、表などの機械可読データを補助資料として添えても構いませんが、必須ではありません。補助資料が規範文と食い違う場合は規範文が優先され、補助資料を修正します。補助資料の有無にかかわらず、Host は規範文を実装し、入力を検証する必要があります。

Host は、自ら明示的に実装した Form に対応します。資源要求に含まれる URL を取得して Form を発見したり、その URL からコードを実行したり、補助資料を自動ダウンロードしたりはしません。仕様を公開しただけでは、どの Host の対応も成立しません。

Form ごとに移植可能性を一律に要求するわけではありません。作者は、特定の実装や環境に限られる Form の意味を定義できます。その場合は、前提となる実装・環境と制約を仕様に明記します。Host API の中立な共通契約が、その Form の移植可能性まで保証するものではありません。

## Form URL の identity と版

Form URL は、ASCII 文字だけで直列化した絶対 HTTPS URL とし、host と path を含めます。userinfo、query、fragment は含めません。URL に非 ASCII 文字が必要な場合は、必要に応じて UTF-8 の percent-encoding を使います。比較は直列化された URL の文字列完全一致です。大文字・小文字の変更、path の正規化、redirect、別名、見た目が似た URL を同一 identity とみなしてはいけません。Host は redirect を追跡したり、別 URL に置き換えたりして Form identity を確定してはいけません。

ある URL で公開した仕様の意味は不変として扱います。契約を変更するときは新しい URL を明示的に公開し、旧 URL の意味を黙って変更しません。`/key-value-entry/1.0.0` のような SemVer 形式の path は作者にとって有用な慣習ですが、Takoform が必須とする版系列でも、互換性を推定する規則でもありません。

- `latest`、branch 名など、後から指す内容が変わる URL は資源要求の identity に適しません。
- path に SemVer があっても、互換性を自動推定できるわけではありません。挙動は仕様に記し、新しい identity が必要かは作者が判断します。
- Form の identity と互換性は、Host API の版、SDK・クライアント・各Providerのソフトウェア版とは別です。ソフトウェアだけを更新しても Form URL は変わりません。
- Interface や Binding ごとの独立した package・版系列は必須ではありません。必要な契約は Form 仕様の章として定義するか、独立して管理される版固定の外部契約を参照できます。

公開者がドメインを変更しても、旧 URL はその Form の identity のままです。同じ挙動を新しい URL で公開しても、それは別の identity です。redirect で旧 URL の identity を移転・別名化することはできません。Host とクライアントは既存資源の Form URL を自動で付け替えません。移行する場合は、該当する Host とクライアントの仕様に従って明示的に行います。

## 仕様に記す内容

Form仕様には次の意味を定義します。章の順序や書式は自由で、固定テンプレートや機械schemaは
要求しません。秘密入力やBinding等がない場合は、その項目を「なし」と明記します。

1. **目的と範囲。** 資源の種類と表す対象、使用する Host API の版を記します。Form が実際には所有しない基盤やアプリケーションの挙動まで管理するかのように書かないでください。
2. **入力と既定値。** 公開入力ごとに意味、型、必須性、省略時の扱い、既定値、受理範囲や上限を説明します。Form が定める既定値と Host 実装上の既定値を区別します。作成後に変更できる項目、置換や明示的な移行が必要な項目も記します。
3. **秘密入力。** 秘密値は公開 desired input と分けて列挙し、用途、必須性、必要な秘密入力を利用できない場合の挙動を説明します。秘密値そのものを公開例、schema、observed、output、通常のログに含めないでください。
4. **観測状態、出力、準備完了条件。** 各観測値の意味と、未取得・古い値になり得る条件、各 output の意味を説明します。readiness を示す場合は、観測可能な成立条件を定義します。Form が条件を定義・測定していないのに、資源の管理操作が成功したことをアプリや接続先の稼働保証と同一視しないでください。
5. **操作と失敗。** 対応する create、read、update、delete の挙動、前提、検証、意味のある失敗条件を説明します。結果不明時の再試行が安全かどうかも記します。操作が定義されていても、入力、認可、依存関係、実行環境に問題があれば成功するとは限りません。
6. **参照、所有、削除。** 他資源への参照、その所有者、参照が固定されるか再解決されるか、削除による影響を説明します。削除が対象資源だけに及ぶのか、関連資源やデータにも及ぶのかを明記します。
7. **Interface と Binding（該当する場合）。** Form が必要とする、または提供する接続・操作の意味を説明します。可能なら Form 仕様内に記し、外部契約を参照する場合は安定した正確な identity を使います。参照だけで Host に権限が付与されたり、credential が提供されたりするかのように記してはいけません。
8. **未知 field と拡張。** 入力 object に未知 field がある場合の扱い（拒否、無視、保持、その他の規則）を Form ごとに明記します。未知 field に対する暗黙の共通方針はありません。対象 object の各境界で一貫した規則を定め、既存入力の意味を保ちながら将来拡張する方法も説明します。

Form が特定の実装・環境に依存するなら、その依存条件や制限を Form の契約として明示し、他の環境にも適用できるという含意を避けます。外部標準に挙動を委ねる場合は、対象標準の正確な identity と、委ねる範囲を記します。

## 例：KeyValueEntry（説明用）

以下は規範文の書き方を示す小さな例です。名前と URL は予約された example domain を使っており、実在の ecosystem Form ではありません。

**Form URL:** `https://forms.publisher.example/key-value-entry/1.0.0`

**Host API:** Takoform Host API v2

**目的:** Host が管理する key/value 集合に、名前付きの文字列値を一つ表現する。

### 入力

公開 `spec` object は、次の二つの field のみを持ちます。

| Field | 要件と意味 | 作成後の変更 |
| --- | --- | --- |
| `key` | 必須の文字列。Unicode scalar value で1〜128文字。同じ Host、同じ Space、同じ Form URL の資源内で一意とする。既定値なし。 | 不変。変更する場合は別の entry を作成し、旧 entry を削除する。 |
| `value` | 必須の文字列。Unicode scalar value で0〜4096文字。空文字列も有効。既定値なし。 | 変更可能。update で保存値を置き換える。 |

この Form に秘密入力はありません。`spec` の未知 field は拒否します。長さの上限は UTF-8 byte 数ではなく Unicode scalar value 数で数えます。Host は条件を満たさない入力を、entry を変更する前に拒否します。

### 観測状態と output

登録済みResourceのreadは、背後のentryが見つからない場合も、Host API共通のResourceを返します。
まだ一度も観測していなければ `observed:{}`、`observedAt:null` です。
観測済みなら `entryExists`（boolean）を含め、存在する場合だけ `key` と `value` も含めます。
確認不能を `entryExists:false` にしてはいけません。最後の観測はResourceの `observedAt` の
時点のものです。このFormはGETごとの外部再照会や追加の鮮度保証を要求しません。
未登録のResourceの取得結果は共通Host APIの規則に従います。

この Form の `output` は空 object です。create または update の成功は、Host が要求値を受け付けて保存したことを意味します。外部システムへの複製やアプリケーションの稼働までは保証しません。

### 操作と失敗

- **Create:** entry を一つ追加します。同じ Host、同じ Space、同じ Form URL に同じ `key` の entry があれば、既存 entry を変更せず失敗します。別 Host や別 Form URL の同名 `key` とは衝突しません。
- **Read:** 登録済みResourceと最後に確認できたentryの状態を返します。存在・不在・未観測を上記の形で区別します。entryが外部要因で消えても、管理記録がある間はResourceを返します。
- **Update:** `value` のみ変更できます。`key` を変更する要求は副作用なしで拒否します。entry が見つからない場合、update によって再作成しません。
- **Delete:** このResourceが表すentryを削除します。entryが既にないと確認できた場合も削除完了です。別Resourceや集合を削除しません。既知の作成失敗でerrorになったResourceも、この削除で残存entryと管理記録を後始末できます。

Host がこの Form の entry を所有します。この Form に cross-resource reference、Interface、Binding はありません。削除の影響は対象 entry のみです。

この例では API envelope、operation ID、generation、HTTP status、再試行 key の形式や扱いは定義しません。それらは共通 Host API 仕様に従います。機械可読 schema を使わない実装も、この Form を名乗るなら上記の意味と入力条件を検証する必要があります。


</div>
