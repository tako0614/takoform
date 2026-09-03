---
title: Host API v1 とは
---

# Host API v1 とは

`forms.takoform.com/v1` は、Takoform の literal で client 中立な Host API 契約です。
Host は immutable な Form Definition を install し、exact な FormRef の下で desired
resource を受け取り、lifecycle の状態を返します。

normative な文面は [Host API v1 wire contract](/spec/host-api/v1) が持ちます。この
ページはその読み方の案内で、契約そのものではありません。

## 入口は二つの address だけ

| 役割 | address |
| --- | --- |
| discovery | `GET /.well-known/takoform/v1` |
| API root | `/apis/forms.takoform.com/v1` |
| lifecycle root | `{api}/resources/{formGroup}/{kind}/{name}` |

discovery は advertised lane を一つだけ返します。advertised endpoint は discovery
document と same-origin で、escape した path に percent-encoding、userinfo、query、
fragment を含みません。平文 HTTP は loopback の開発 origin でだけ有効です。

library や Provider の SemVer はこの lane の version ではありません。それらをrelease
しても discovery と route は動きません。APIのbehaviorを変えるときだけ新しいmajor
laneを作ります。

## 何が wire に入り、何が入らないか

Host API が定義するのは generic な lifecycle substrate だけです。discovery、
validation、prepare / apply / read / observe / delete、fence、Operation。
Form の kind は wire に埋め込まれません。既存の標準がない resource 固有の runtime
operation は、その Form が exact な Interface / Binding contract として宣言します。

## 四要素の FormRef

```json
{
  "apiVersion": "forms.example.com",
  "kind": "ExampleResource",
  "definitionVersion": "0.3.0",
  "schemaDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

四つすべてが equality、catalog lookup、保存された identity、relation の pin、
idempotency fingerprint、support の回答に参加します。`latest`、省略された
definition version、group と kind だけの別名、best available は、どの route も
受け付けません。四要素を解決できなければ mutation の前に `form_unknown` です。

## identity は三つの counter で動く

- `uid` は一つの incarnation について immutable です。delete して作り直すと変わります。
- `generation` は `1` から始まり、portable な desired state が変わったときだけ進みます。
- `revision` は `1` から始まり、Host が観測した status や output の変化でも進みます。

create は `If-None-Match: *` を要求します。update、observe、既存 resource の prepare、
delete は `Takoform-Expected-Generation` か、operation table が許す同等の body field を
要求します。fence が無ければ `invalid_argument`、generation が古ければ
`generation_conflict`、revision が古ければ `revision_conflict`、想定と違う incarnation を
指していれば `uid_mismatch` です。

## 閉じた error 語彙

error code は閉じています。実装がこの lane で新しい portable code や reason を
足すことはありません。HTTP status と自動 retry 可能性は
[`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
が固定します。

## machine document

wire を実装または検証するときに読む bytes です。公開 schema の exact bytes と
digest は [公開 schema](/schemas/) で確認できます。

| document | 役割 |
| --- | --- |
| [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json) | route と fence の完全な表 |
| [`host-discovery.schema.json`](https://forms.takoform.com/schemas/v1/host-discovery.schema.json) | discovery document |
| [`form-ref.schema.json`](https://forms.takoform.com/schemas/v1/form-ref.schema.json) | exact な Form identity |
| [`host-api-wire.schema.json`](https://forms.takoform.com/schemas/v1/host-api-wire.schema.json) | resource と error の envelope |
| [`operation.schema.json`](https://forms.takoform.com/schemas/operations/v1/operation.schema.json) | 長時間 Operation の記録 |
| [`host-support-profile.schema.json`](https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json) | Host の support 回答 |

## 次に読む

- [共通モデル](/model/) — FormRef から Snapshot までのデータ形
- [conformance と参照実装](/conformance/) — 何を証明したことになるのか
- [Versioning and compatibility](/spec/versioning) — 二つの domain version 軸
