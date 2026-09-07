# takoform.com の所有と公開

表示にはVitePress標準の配色、フォント、部品を使います。独自ロゴやロゴ入りの共有画像は
使わず、サイト名をテキストで表示します。トップページと日本語の案内では
用途と操作を直接説明し、宣伝的なコピーや不要な内部用語を増やしません。正確なAPI名や
フィールド名、固定済みの仕様本文は変更せず、解説と区別します。

`takoform.com` は Host API v1 と publisher 中立な共通モデルだけを配信する site です。
この repository がその source、build、deploy entrypoint を所有します。realized な CDN、
DNS、account / zone / route、credential、operator の状態は所有しません。それらは公開を
行う operator の authority です。

site の見た目や案内文は Host API v1 とは独立して配信できます。この deploy は固定された
Host API v1 を変更せず、新しい API version や specification release lane を作りません。
一方、schema の exact bytes（および将来 freeze される normative API bytes）は consumer が
参照する identity なので、presentation と同じ rollback 条件では扱いません。

## 現在の repository 配置と local 開発

```text
website/
├── .vitepress/            VitePress config と theme（手書き）
├── index.md               landing（手書き）
├── start/  guides/  reference/  glossary.md
│                          読み方・参照・用語の入口（手書き）
├── host-api/  model/  conformance/  site.md
│                          読み方の案内（手書き）
├── spec/                  freeze に含まれる source の mirror（生成）
├── schemas/               schema 索引 page（生成・non-normative）
└── public/
    ├── schemas/           公開 schema の bytes（生成）
    ├── _headers  robots.txt
    └                      配信 header、robots、site assets（手書き）
```

生成部分の正本は次です。手で編集した内容は gate が差し戻します。

- [`scripts/site.mjs`](../scripts/site.mjs) — mirror page、索引 page、公開 schema bytes、
  build 出力の検査

```console
bun scripts/site.mjs --write        # 生成物を書き直す
bun run check:site                  # 生成物が導出と一致するか
bun run build:site                  # build して配信面を検査する
bun run site:dev                    # 手元で見る
```

`bun run check` はこれらの検査を含みます。生成物が古いまま commit されることはありません。

`site:dev` は VitePress の local search を含む手元の確認用です。dependency の開発時
optimizer だけを `esnext` に合わせています。release build の target と schema の bytes は
この設定では変わりません。

`build:site` は生成後の全 HTML について、title、ページ別の OG / Twitter metadata、language、document authority、重複 ID、
ARIA の参照先、内部 route / fragment、到達不能 page、mirror notice と home の主要構造を
検査します。手書き public asset の source と build の
byte 一致も検査します。pixel geometry や browser 固有の interaction は静的 HTML からは証明できない
ため、presentation を変更したときは次の explicit browser lane も実行します。

```console
bun run check:site:browser
```

この command は再現可能な site build を作り、loopback の一時 port で配信して、installed
Chrome / Chromium を headless で動かします。browser が見つからなければ失敗します。
標準 path にない場合は `TAKOFORM_BROWSER=/absolute/path/to/chrome` を設定してください。
browser の自動 download や、既存 browser profile の利用はしません。

- `/`、`/start/`、`/guides/`、`/reference/`、`/glossary`、`/host-api/` を
  320 / 375 / 414 / 768 px で開き、横 overflow と切れた操作要素がないことを確認する。
- mobile navigation と sidebar を keyboard で開き、Escape で閉じたあと trigger へ focus が
  戻ることを確認する。
- 1280 px の light / dark 両方で first viewport の主要 CTA と keyboard focus indicator を確認する。
- asset の HTTP error、JavaScript error、予期しない外部通信も失敗として扱う。

本文、link、button、code highlighting の contrast と見た目の最終判断は、light / dark の
実画面で別途確認します。この browser lane は live service や production mutation を必要とせず、
portable な `bun run check` へ browser binary を暗黙に要求しません。

`.hallmark/preflight.json` は変更前の visual inventory、`.hallmark/log.json` は redesign 時の
判断と確認した viewport の履歴です。site/theme の owner が更新し、公開物へは含めません。
`check:site` は JSON の構造を検査しますが、記録された目視評価を現在の検査結果として扱いません。

## 配信する path

| path | 中身 |
| --- | --- |
| `/`、`/start/`、`/guides/`、`/reference/`、`/host-api/`、`/model/`、`/conformance/`、`/glossary`、`/site` | 手書きの案内 |
| `/spec/**` | freeze-listed source は normative mirror。それ以外の overview/index mirror は non-normative。正本は `spec/**` |
| `/schemas/` | identity の non-normative 索引 page |
| `/schemas/<$id と同じ path>` | 公開 schema の exact な bytes |
| `/sitemap.xml`、`/robots.txt`、`/404.html` | site の付随物 |

個別FormのDefinition、example、catalog、Form pageは配信しません。それぞれの
publisherが自分のsiteへdeployします。site独自のwell-known statusや文書集合versionも
公開しません。

公開 schema の `$id` は `https://forms.takoform.com/schemas/...` です。append-only な
正本は [`release/public-schema-identities.json`](../release/public-schema-identities.json)
で、各 entry の `public` field がこの repository 内の path を、`id` の path が配信 URL を
名指します。両者が一致することは `bun run check:site` が検査します。

## 現在の operator 手順（preview と定常公開）

以下は operator が自分の account で行う操作です。この repository は account、zone、
credential を持ちません。

1. **Pages project を作る。** project 名は `takoform-site`、production branch は `main`。
   git 連携は使わず direct upload だけを使います（deploy entrypoint が一回だけ
   upload します）。project 作成自体はこの entrypoint の仕事ではありません。
2. **Wrangler の profile を用意する。** `wrangler login` を実行し、Pages project を
   読み書きできる operator の profile を選びます。deploy entrypoint は
   `wrangler pages project list --json` で profile と project の可読性を確認します。
   credential の環境変数を repository に置く必要はありません。
3. **preview で確かめる。**

   ```console
   bun run deploy -- takoform-site --status
   bun run deploy -- takoform-site --apply --environment integration
   bun run deploy -- takoform-site --apply --environment integration --execute
   ```

   `--status` は read-only で、Wrangler の project list に `takoform-site` が存在するかと
   custom domains を報告します。`--execute` の無い `--apply` は plan で provider を
   読みません。実行する apply は gate の前に同じ read-only project list を preflight し、
   profile が未認証・可読不能、または project が存在しない場合は upload に進みません。
   preview は `takoform-site.pages.dev` の per-deployment URL に出ます。immutable URL
   から landing page、sitemap、ledger にある current 33件と retired 15件の schema を
   byte 単位で読み戻し、撤去した catalog/status/release/decision route も不在であることを
   確認します。schema の sample 2件だけで成功にはしません。
## 一度限りの historical runbook（initial cutover の記録）

以下の手順4〜6は、Host API v1 の identity/domain を最初に切り替えるための一度限りの
historical runbook です。現在の routine production deploy と混同しないでください。手順、
receipt、旧 owner の識別子は cutover evidence として保持しますが、通常の deploy path で
再利用するものではありません。

4. **最初の production deployment を作る。** domain を動かす前に、clean な public
   `main` で次を順に実行します。これは `takoform-api-v1-cutover` が一度だけ所有する
   Host API v1 の identity/domain cutover です。`--review` は変更を作成していない reviewer または
   deliberate review の非secretな evidence reference であり、deploy の許可ではありません。
   値は `audit_`、`review_`、`operator_`、`agent_`（または同じ語と `:`）から始まる
   小文字の label だけを受け付け、free-form text、credential、account ID は渡しません。

   ```console
   bun run deploy -- takoform-api-v1-cutover --apply --environment production --review audit_takoform_live_cutover_owner
   bun run deploy -- takoform-api-v1-cutover --apply --environment production --review audit_takoform_live_cutover_owner --execute
   ```

   execute は upload の前に次をすべて要求します。

   - Pages project が存在し、production deployment が gate 前と upload 直前のどちらにも
     一つもないこと（通常 production mode は空の history に最初の upload を行えません）
   - 既存 `https://forms.takoform.com` が ledger の31件を redirectなしの HTTP 200 と
     exact digest で返すこと
   - 残る固定17件を redirectなしの exact HTTP 404 で返すこと
   - `check:site` と `build:site` が、これから送る全schemaを含む同じdistを証明すること

   Wrangler の project list は production branch の設定値を返さないため、branch は receipt の
   residual として明示されます。upload は `main` に固定し、返った deployment URL が production
   history に存在することを upload 後に readback します。custom domain はこの時点で一つも
   attach されていないことを project list で確認します。

   17件の集合は live audit と一致する定数として entrypoint に固定されています。1件でも
   status、redirect、bytes、ledger partition が変われば upload 前に停止します。その後の
   direct upload は一回だけで、返された immutable deployment URL と
   `https://takoform-site.pages.dev` の両方から全48 schema、page、negative route を読み戻します。
   custom domain がまだ付いていないことは失敗にしません。

   deployment list の確認と upload は provider 上の atomic operation ではありません。この一回の
   bootstrap 中は他の Pages writer を止め、同じ operator が手順を直列化します。entrypoint は
   長い build と48件の旧host audit後、upload の直前に空のproduction historyを再確認します。

   成功時の stdout は `kind: takoform.site-initial-cutover-pending`、
   `status: pending-domain-cutover` の JSON receipt です。receipt は Pages deployment URL、
   source commit/digest、31/17 partition、review reference、および旧 owner の次の公開識別子を
   含みますが、credential や Cloudflare account ID は含みません。

   - Worker: `takoform-website`
   - version: `1e4871b5-e4b3-4c30-8bb9-78592b5ce49e`
   - deployment: `9eae618a-4144-4115-abe4-3a50dae795af`
   - source: `f71d4be4caf5a5e0c4fc97bfadeb6ebb627d1928`

5. **operator が custom domain を移す。** Pages project の custom domain は必ず
   **`www.takoform.com` → `takoform.com` → `forms.takoform.com`（forms last）** の順で
   追加・移動します。これは pending receipt の後に operator が行う authority です。
   DNS、Worker route の解除、Pages custom domain の設定はこの repository が行いません。
   Cloudflare の custom domain は同時に一つの service にしか付けられないため、一時的な
   不通を最小にする順序も operator が直列化します。

   `forms.takoform.com` を最後に移す操作が irreversible な topology boundary です。その
   時点で、それまで404だった17件の consumer-pinned `$id` が初めて公開され、旧 Worker は
   rollback target ではなくなります。以後の失敗は Pages history からの forward repair だけです。

6. **uploadせず cutover を検証する。** 手順4の receipt にある exact immutable URL を使います。

   ```console
   bun run deploy -- takoform-api-v1-cutover --verify-cutover --deployment-url https://<deployment>.takoform-site.pages.dev
   ```

   verifier は clean な local `main` と credential/configを隔離して読んだ public `main` の一致を
   要求し、指定URLがWranglerで読み取ったproduction deployment historyの実在URLであることを
   gate前に確認します。branch aliasは受け付けません。local site を build して ledger と全schema
   bytesを再確認したうえで、immutable URL、
   `https://takoform.com` と `https://www.takoform.com` の page/negative route、
   `https://forms.takoform.com` の全48 schemaを読み戻します。Wrangler の
   `pages project list --json` が返す三つの custom domain 所有を要求し、現在の CLI が
   domain field を返さない場合は verifier が gate 前に停止します。certificate/activation 状態を
   返さないことだけは receipt に residual として記録します。HTTPS の exact readback が実際の
   serving evidence です。Wrangler の read-only history/list 以外に、
   upload、project作成、domain操作は行いません。

   この確認と operator-retained receipt の保存が終わったら、一回限りの
   `--initial-cutover`、31/17 partition、旧 Worker 識別子は通常の deploy path から削除します。
   全48 schema の ledger-driven readback と forward-repair 制約は残します。
## 現在の定常 production 更新

7. **以後の production 更新。** initial cutover flag は再利用しません。

   ```console
   bun run deploy -- takoform-site --apply --environment production
   bun run deploy -- takoform-site --apply --environment production --execute
   ```

   通常 production も clean な exact public `main`、一回のupload、immutable URLの全schema
   readback、apex と www の page/negative readback、`forms.takoform.com` の全schema readbackを
   要求します。通常の `takoform-site` surface は `--initial-cutover` と `--verify-cutover` を
   受け付けず、Host API v1 の identity/domain 操作は上の cutover surface に分離されています。

presentation だけの不具合は、全48 schemaが同じbytesであることを確認できる以前の Pages
deployment へ戻せます。しかし initial domain cutover 後に旧 Worker へ戻すと、新しく公開した
17件が消えます。schema、domain cutover、または readback が失敗した場合は provider history を
読み、全48件を保持する Pages deployment へ forward repair します。自動 rollback や blind retry
は行いません。

## 以前の site を superseded にする

`takoform.com` は以前、別 repository から build された site が配信していました。API と
共通モデルの page はこの repository が所有し、Form catalog の page は publisher が
所有します。手順 4 と 5 で hostname が Pages project を向いた時点で、以前の site は
superseded です。以前の site の Worker と route を残すかどうかは operator の判断で、
この repository はそれを操作しません。

`$id` が指す bytes は、どちらの site から配信されても同じでなければなりません。占有
された `$id` の bytes が変わることはなく、撤回は retired 記録へ移って bytes と理由を
保ちます。切り替えは配信元の変更であって、identity の変更ではありません。

## 境界

- deploy するかどうかは operator の判断です。task、branch、green check のいずれも
  deploy を承認しません。
- secret、credential、realized な configuration、deploy 記録をこの repository に
  commit しません。
- CI から production を変更しません。CI が実行するのは read-only な `bun run check` です。
- self-host、および operator が自分の環境へ配信することは別の authority です。
