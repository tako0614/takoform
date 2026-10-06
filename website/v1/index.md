---
title: Host API v1
description: Host API v1の仕様、共通モデル、スキーマと検証資料への入口です。
---

# Host API v1 {#v1}

既存のv1 Hostやクライアントを扱うためのAPI仕様、共通モデル、検証資料をまとめています。

## API仕様 {#api}

- [HTTP API仕様](/spec/host-api/v1) — 接続先、要求と応答、操作の規則。
- [互換性と版管理](/spec/versioning) — 版の扱いと互換性の境界。

## リソースと接続のモデル {#model}

- [Form Definition](/spec/form-definition/) — リソースの定義。
- [Form Package](/spec/form-package/)と[Snapshot](/spec/core/) — 定義の配布と解決。
- [Interface](/spec/interface-contract/)と[Binding](/spec/binding-contract/) — 接続の契約。
- [Trustと失効](/spec/trust/) — v1の検証に関する規則。

## 検証とツール {#tools}

- [スキーマ一覧](/schemas/) — 公開JSON Schema。
- [適合性](/spec/conformance)と[検証ツール](/conformance/) — 検査対象とその境界。
- [OpenTofu / Terraform Providerの利用案内](https://github.com/tako0614/terraform-provider-takoform/blob/main/README.md#quick-start) — Providerを使ってv1 Hostに接続する手順。
