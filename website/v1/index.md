---
title: Host API v1
description: 固定されたHost API v1のAPI契約、共通モデル、スキーマと検証資料への入口です。
---

# Host API v1 {#v1}

既存のv1実装を読む・利用するためのドキュメントです。固定された仕様本文と公開スキーマを維持しています。v2の仕様は、この版への追加要件ではありません。

## APIを実装する {#api}

- [HTTP API仕様](/spec/host-api/v1) — 接続先、要求と応答、操作の規則。
- [互換性と版管理](/spec/versioning) — 版の扱いと互換性の境界。

## 共通モデルを読む {#model}

- [Form Definition](/spec/form-definition/) — リソースの定義。
- [Form Package](/spec/form-package/)と[Snapshot](/spec/core/) — 定義の配布と解決。
- [Interface](/spec/interface-contract/)と[Binding](/spec/binding-contract/) — 接続の契約。
- [Trustと失効](/spec/trust/) — v1の検証に関する規則。

## 検証・既存ツール {#tools}

- [スキーマ一覧](/schemas/) — 公開JSON Schema。
- [適合性](/spec/conformance)と[検証ツール](/conformance/) — 検査対象とその境界。
- [Providerの利用案内](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start) — このProviderをOpenTofuやTerraformから使う手順。ProviderはAPI仕様とは別の実装です。

## v2を調べる場合 {#v2}

[v2ドキュメント](/v2/)は独立した版の資料です。[移行案内](/spec/host-api/v2/migration)で違いを確認できます。版を切り替えても、稼働中のHostや既存リソースが自動で移行されることはありません。
