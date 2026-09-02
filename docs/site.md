# takoform.com の所有と公開

`takoform.com` は Host API v1 と publisher 中立な共通モデルだけを配信する site です。
この repository がその source、build、deploy entrypoint を所有します。realized な CDN、
DNS、account / zone / route、credential、operator の状態は所有しません。それらは公開を
行う operator の authority です。

## repository 内の配置

```text
website/
├── .vitepress/            VitePress config と theme（手書き）
├── index.md               landing（手書き）
├── host-api/  model/  conformance/  site.md
│                          読み方の案内（手書き）
├── spec/                  normative 文面の mirror（生成）
├── schemas/  decisions/  releases/
│                          索引 page（生成）
└── public/
    ├── schemas/           公開 schema の bytes（生成）
    ├── .well-known/takoform-site.json
    │                      status document（生成）
    ├── _headers  robots.txt
    └                      配信 header と robots（手書き）
```

生成部分の正本は次の二つです。手で編集した内容は gate が差し戻します。

- [`scripts/site.mjs`](../scripts/site.mjs) — mirror page、索引 page、公開 schema bytes、
  build 出力の検査
- [`scripts/site-status.mjs`](../scripts/site-status.mjs) —
  `/.well-known/takoform-site.json` の導出

```console
bun scripts/site.mjs --write        # 生成物を書き直す
bun run check:site                  # 生成物が導出と一致するか
bun run build:site                  # build して配信面を検査する
bun run site:dev                    # 手元で見る
```

`bun run check` はこの二つを含みます。生成物が古いまま commit されることはありません。

## 配信する path

| path | 中身 |
| --- | --- |
| `/`、`/host-api/`、`/model/`、`/conformance/`、`/site` | 手書きの案内 |
| `/spec/**` | normative 文面の mirror。正本は `spec/**` |
| `/schemas/` | identity の索引 page |
| `/schemas/<$id と同じ path>` | 公開 schema の exact な bytes |
| `/decisions/`、`/releases/` | 索引 page |
| `/.well-known/takoform-site.json` | `takoform.spec-site-status@v1` |
| `/sitemap.xml`、`/robots.txt`、`/404.html` | site の付随物 |

公開 schema の `$id` は `https://forms.takoform.com/schemas/...` です。append-only な
正本は [`release/public-schema-identities.json`](../release/public-schema-identities.json)
で、各 entry の `public` field がこの repository 内の path を、`id` の path が配信 URL を
名指します。両者が一致することは `bun run check:site` が検査します。

## operator の手順

以下は operator が自分の account で行う操作です。この repository は account、zone、
credential を持ちません。

1. **Pages project を作る。** project 名は `takoform-site`、production branch は `main`。
   git 連携は使わず direct upload だけを使います（deploy entrypoint がその一回の
   upload を行います）。
2. **credential を用意する。** `CLOUDFLARE_ACCOUNT_ID` と、Pages の編集権限だけを持つ
   `CLOUDFLARE_API_TOKEN` を operator の環境に置きます。repository には置きません。
3. **preview で確かめる。**

   ```console
   bun run deploy -- takoform-site --status
   bun run deploy -- takoform-site --apply --environment integration
   bun run deploy -- takoform-site --apply --environment integration --execute
   ```

   `--status` は read-only、`--execute` の無い `--apply` は plan です。preview は
   `takoform-site.pages.dev` の per-deployment URL に出ます。ここで page と
   `/.well-known/takoform-site.json` と schema URL を実際に読みます。
4. **custom domain を付ける。** Pages project の Custom domains に `takoform.com` を
   追加し、必要なら `www.takoform.com` も追加します。DNS record の作成と検証は
   operator の操作です。
5. **schema の `$id` host を移す。** `forms.takoform.com` を同じ Pages project の
   custom domain として追加すると、`$id` の path がそのまま解決します。**この
   hostname は現在、別 repository から build された Worker が保持しています。**
   Cloudflare の custom domain は同時に一つの service にしか付けられないので、
   Worker 側の route を外してから Pages project に付ける順序になります。その間だけ
   `$id` URL は解決しません。移す前に手順 3 の preview で、同じ digest の bytes が
   同じ path から返ることを確認してください。
6. **production を publish する。**

   ```console
   bun run deploy -- takoform-site --apply --environment production --execute
   ```

   production は clean な `main` だけを受け付け、local HEAD が credential-free に読んだ
   公開 `refs/heads/main` と一致しない限り、target に触れる前に refuse します。upload の
   あと、per-deployment の immutable URL と `https://takoform.com` の双方から
   status document と schema を読み直し、digest が build 出力と一致しなければ halt します。

戻すときは Pages project の deployment history から直前の production deployment を
promote します。配信される schema bytes は `spec/schemas/` の source と byte 単位で
同一で、その digest は append-only ledger が固定しているので、古い deployment でも
すでに mint 済みの `$id` を同じ bytes で配信します。

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
