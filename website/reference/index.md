---
title: Reference
---

# Reference

このページは non-normative な索引です。

ここは、英語で書かれた contract source と、日本語で書かれた案内を見分けるための
reference です。英語だから自動的に normative になるわけでも、日本語だから無効に
なるわけでもありません。下の `authority` 列と、Host API v1 の freeze manifest を
基準にしてください。

## English source と authority

| route | language | authority |
| --- | --- | --- |
| [`/spec/host-api/v1`](/spec/host-api/v1) | English | normative な Host API v1 wire prose。bytes は freeze 対象 |
| [`/spec/conformance`](/spec/conformance) | English | normative な conformance language。freeze 対象 |
| [`/spec/versioning`](/spec/versioning) | English | normative な version / identity rule。freeze 対象 |
| [`/spec/form-definition/`](/spec/form-definition/) | English | normative な Form Definition contract。freeze 対象 |
| [`/spec/form-package/`](/spec/form-package/) | English | normative な Form Package contract。freeze 対象 |
| [`/spec/core/`](/spec/core/) | English | normative な Snapshot contract。freeze 対象 |
| [`/spec/interface-contract/`](/spec/interface-contract/) | English | normative な Interface contract。freeze 対象 |
| [`/spec/binding-contract/`](/spec/binding-contract/) | English | normative な Binding contract。freeze 対象 |
| [`/spec/artifact-transport/`](/spec/artifact-transport/) | English | normative な artifact transport contract。freeze 対象 |
| [`/spec/standard-services/`](/spec/standard-services/) | English | normative な standard-service contract。freeze 対象 |
| [`/spec/trust/`](/spec/trust/) | English | normative な trust / revocation contract。freeze 対象 |
| [`/spec/form-families`](/spec/form-families) | English | normative な versionless family-group rule。freeze 対象 |
| [`/spec/portability-boundary`](/spec/portability-boundary) | English | normative な portable boundary。freeze 対象 |
| [`/spec/host-api/`](/spec/host-api/) | English | non-normative な navigation |
| [`/spec/README`](/spec/) | English | non-normative な contract map |
| [`/spec/schemas/`](/spec/schemas/) | English | non-normative な schema navigation。bytes の authority ではない |

`spec/host-api/v1.freeze.json` が列挙する normative prose、machine root、recursive
schema closure だけが、現在の Host API v1/common-model の frozen closure です。
mirror page の先頭にも canonical source が表示されます。mirror は link address を
site 用に移した copy で、source repository の bytes が読み取りの基準です。

## Machine contract

[公開 schema](/schemas/) は human page ではなく、各 schema の `$id` が示す path で
exact な bytes を読むための入口です。schema が structural minimum を検査しても、
Definition、Package、Snapshot、Host の semantic contract 全体を単独では保証しません。
必要な意味規則は、上の frozen source と [conformance](/conformance/) を一緒に読んで
ください。

操作 table と report を直接確認する場合は、repository の source を参照します。

- [`operations-v1.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/operations-v1.json)
  — route、fence、status、error の machine table
- [`v1.freeze.json`](https://github.com/tako0614/takoform/blob/main/spec/host-api/v1.freeze.json)
  — frozen closure の path と digest
- [`generic.json`](https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json)
  — package / contract / Snapshot の synthetic corpus

## Japanese guide の位置づけ

次の pages は reader のための hand-authored guide です。いずれも contract を拡張せず、
route と読み方だけを説明します。

| route | 役割 |
| --- | --- |
| [`/start/`](/start/) | 実行できる synthetic journey と概念 transcript |
| [`/guides/`](/guides/) | audience 別の読み順 |
| [`/host-api/`](/host-api/) | Host API v1 の短い読み方 |
| [`/model/`](/model/) | common model の短い読み方 |
| [`/conformance/`](/conformance/) | conformance claim の読み方 |
| [`/glossary`](/glossary) | canonical English token と日本語説明 |
| [`/site`](/site) | site の scope と ownership |

これらの guide や site の presentation は、Host の稼働、publisher の公開、
commercial Offering、client の対応状況を証明しません。
