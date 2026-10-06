---
title: Host API v2
description: Host API v2の仕様、概念と実装ガイドを案内します。
---

# Host API v2 {#v2}

Host API v2は、Hostが管理するResourceを作成・取得・更新・削除する共通HTTP契約です。FormがResource固有の意味を定義し、HostがそのFormを実装します。クライアントは両方を理解して操作します。

## 仕様を読む {#chapters}

- [概要と基本概念](/spec/host-api/v2/) — Form、Host、Resource、Operationと所有境界。
- [HTTP API](/spec/host-api/v2/http) — Discovery、要求/応答、認可、generation、retry、エラー。
- [Form要件](/spec/host-api/v2/forms) — Form作者が仕様で定義するResource固有の意味。
- [要求から削除までの説明例](/spec/host-api/v2/examples) — 架空のHost/Formを使う非規範の要求・応答例。
- [v1からの移行案内](/spec/host-api/v2/migration) — 明示的な製品移行時に判断する項目。自動変換手順ではありません。

概要・HTTP API・Form要件は規範仕様です。例とmigrationは仕様を理解するための解説です。

## 読む順序 {#reading}

用語を確認したい場合は[v2用語集](/glossary)を参照してください。

- **利用者:** [使い始める](/start/)の一連の架空HTTP walkthroughから、詳細な[要求・応答例](/spec/host-api/v2/examples)へ進みます。
- **Form作者:** [Form要件](/spec/host-api/v2/forms)でspec・observed・outputと失敗時の意味を定義します。
- **クライアント実装者:** [クライアント設計ガイド](/client/)で操作意図、再送期限、Operationと世代競合の扱いを読み、[HTTP再送契約](/spec/host-api/v2/http#retry)を確認します。
- **Host実装者:** [Host実装ガイド](/host-api/)で耐久性境界を確認してから、概要・HTTP API・実装する各Formを読みます。
